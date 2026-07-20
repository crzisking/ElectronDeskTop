# Agent v2 重寫設計 — Vercel AI SDK + opencode 模式 + Vue/Vanilla 混合渲染

> **本文取代已移除的舊 Agent 文檔(原 docs/14 功能設計、docs/17 訊息渲染)**,是 Agent 的唯一現行設計。
>
> **狀態**:已實作並上線(側邊欄「aiAgent」入口 → 獨立窗;`electron/main/agent/**`)。下文 §10 分階段計劃為歷史脈絡。
>
> **編排內核選型**:**Vercel AI SDK v7**(`ai` + `@ai-sdk/*` provider 套件),
> 這正是 opencode 用的底座。設計思路 = **opencode 的架構模式**(見下)跑在
> **Vercel AI SDK 的引擎**上,前端是 Electron 桌面端。
>
> 選型演進(留個脈絡):早期規劃 Claude Agent SDK → 一度考慮 pi(piagent)→ 最終選 Vercel AI SDK。
> 選 Vercel 而非 pi 的關鍵理由:
>   1. **生態最成熟**、providers 最全、文檔最齊、長期維護零風險。
>   2. **AI 協作友善** — 本專案基本靠 AI 寫代碼,AI 對 Vercel AI SDK 的掌握遠勝小眾框架,少踩坑、易維護。
>   3. **v7 內建 `ToolLoopAgent`** — LLM + 工具 + 多步迴圈打包好,連 opencode 當年自寫的 loop 都省了。
>   4. **跟 opencode 同底座** — 要「opencode 模式」,用它同一塊地基最忠實。
>
> **從 opencode 借來的模式**(與底座無關,是「怎麼組織 agent」的設計):
>   1. **無頭 agent 後端 + 薄客戶端**:agent 核心在 Electron main,renderer 是 client(我們用 **IPC**,不用 HTTP+SSE —
       只服務桌面端一個前端,IPC 最簡單、延遲最低、不開埠更安全)。
>   2. **宣告式 permission 配置**:單一 `permission` 物件,`*` 預設 + 逐工具 + glob + 最後命中者贏 + once/always(§5)。
>   3. **session/message 模型**:session 可 fork、訊息分同步 / async、事件流統一。
>   4. **工具動作分類法**:read/edit/glob/grep/bash/webfetch/websearch/external_directory/doom_loop。
>
> **與 opencode 的唯一刻意差異**:**不預設任何 model**。opencode 開箱帶預設 model / models.dev,
> 有 key 就能跑;本專案在使用者配好「端點 URL(+ API key)」之前 agent 一律不可用,
> model 從該 URL 動態拉清單選(§4.2)。其餘一切盡量照 opencode。
>
> **使用情境**:製造業公司內部軟體,部署在公司內網的 Windows 桌面,信任邊界 = 企業內網。
> 安全設計以「**防誤操作 + 操作可追溯**」為主軸,不假設使用者有惡意。設計選型(明文落地 API key、
> 寬鬆 Pinia 暴露)都在此前提下的取捨,不要套用到面向消費者的場景。

---

## 0. TL;DR

```
─── 編排內核 ──────────────────────────────────────────
用 Vercel AI SDK v7(opencode 同底座),丟掉自寫的 OpenAI tool loop:
  - 跑在 Electron main(Node runtime,API key 不出 main)
  - 一律走 @ai-sdk/openai-compatible,對「使用者配置的端點 URL」發請求
  - ⚠️ 唯一不學 opencode:不預設任何 model —— 配好 URL(+key)才能用,
    model 從該 URL 的 /models 動態拉清單讓使用者選(opencode 是開箱帶預設 model)
  - 迴圈用 v7 的 ToolLoopAgent(或 streamText + stopWhen 要細控時);
    串流解析 / tool_call 拼裝 / 多輪循環全由 SDK 處理
  - 工具用 tool({inputSchema: zod, execute}) 自己定義(檔案/Bash/Windows),無 MCP
  - DB schema 保留(agent_configs / agent_messages),只擴 KV key

─── 傳輸 ──────────────────────────────────────────────
IPC,只服務桌面端一個前端(不做 HTTP+SSE):
  - main = 無頭 agent 後端;renderer = client
  - main → renderer 用 IPC push 推串流事件(從 AI SDK fullStream 適配)

─── 渲染策略 ──────────────────────────────────────────
按更新頻率切兩半:
  - 慢更新(layout、sidebar、對話切換、設定 dialog)→ Vue + Pinia
  - 串流熱路徑(每秒幾十~上百 token、tool 卡片動態)→ vanilla DOM mutation
  - 銜接點:Controller pattern — Vue 提供 ref,內部由 class 直接動 DOM

─── Permission 模型(借 opencode)────────────────────────
宣告式 permission 配置,三態 allow/ask/deny,逐工具 glob,最後命中者贏:
  - AI SDK 無內建權限 → 用「包一層 tool.execute」的 gate 落地
  - 終端使用者(工廠員工)彈框只給「允許本次 / 拒絕本次」;規則由開發者以 JSON 出廠控管,不開放使用者管理頁
  - 額外守衛:external_directory(出 workspace 就問)、doom_loop(重複打轉自動攔)
  - 系統路徑 / 危險命令寫死 deny,不問
```

---

## 1. 為什麼要重寫

### 1.1 編排層的問題

現況 (`src/features/agent/composables/useAgentChat.ts` + `useAgentStream.ts`):

- 自寫 OpenAI streaming 解析 + tool_call accumulator + 多輪循環
- Bash / Read / Write 都自寫 (`electron/main/services/agent-tool.service.ts` ~287 行)
- 每加一個 provider 要寫一份 adapter

**Vercel AI SDK v7 接手後**:

- 串流解析、`tool-call` 拼裝、stop reason、reasoning/thinking 區塊 → SDK 的 `streamText` / `ToolLoopAgent` 全包。
- 多輪 agentic 迴圈(LLM → 工具 → 回填 → 再 LLM)→ `ToolLoopAgent` 內建;要逐步細控時用 `streamText` +
  `stopWhen: stepCountIs(N)`。
- 多 provider adapter → 官方 provider 套件(`createAnthropic` / `createOpenAI` / `createOpenAICompatible`)一行取代。

**仍是我們的**(誠實邊界):

- **工具實作**:AI SDK 不附帶檔案 / Bash 工具,我們用 `tool()` 自己定義(read/write/edit/glob/grep/bash/webfetch + Windows
  工具)。拿到的是乾淨的 `tool` 介面 + SDK 自動的工具呼叫拼裝。
- **權限策略**:AI SDK 無內建權限,我們在「包 `tool.execute`」的 gate 內自寫 allow/ask/deny(§5)。
- **session 持久化**:AI SDK 是無狀態的(每次呼叫傳入 `messages`),歷史 / fork / resume 由我們寫進 SQLite。

淨效果:刪掉「串流解析 + tool_call 拼裝 + 多輪循環 + per-provider adapter」整層(現況最脆弱的部分),工具改成標準 `tool()`
,免費獲得多 provider,並用一個 AI 極熟的成熟底座。

### 1.2 渲染層的問題

現況 streaming token 走 Vue reactive 全鏈路:

- token delta → `assistantMsg.content +=` → Vue Proxy 觸發 → MessageRenderer 重渲 → parse-blocks 重切 → markdown 重
  parse → highlight.js 重跑
- 即使有 rAF 節流,100 token/s 速率下仍偶發跳幀
- 工具卡片每次狀態更新(pending → executing → done)也走全鏈路

把 streaming 從 Vue 響應式拿掉,改純 DOM mutation,token 速率上限就只剩網路。

### 1.3 為什麼不全丟 Vue

Vue 在「真正需要結構性更新」的地方仍然是對的工具:對話列表、設定表單、訊息結構增刪、多語/主題切換。這些以「人類動作」為單位(
秒級以下),Vue overhead 可忽略。**只有 token streaming 屬於亞秒級熱路徑**,需要脫出響應式。

---

## 2. 進程拓撲(無頭後端 + 桌面 client,IPC 串接)

```
┌────────────────────── electron main(無頭 agent 後端)──────────┐
│                                                                │
│  AgentRuntime (single instance)                                │
│    ├─ Vercel AI SDK v7                                          │
│    │    ToolLoopAgent / streamText — 迴圈 + 串流 + 工具呼叫       │
│    ├─ ModelProvider  createAnthropic / openai / openai-compatible│
│    │    (依 config 選 provider + model + baseURL)               │
│    ├─ SessionManager  對話持久化 / fork / resume(讀寫 messages) │
│    ├─ PermissionPolicy allow/ask/deny 決策中心(包在 tool.execute)│
│    ├─ ConfigStore     讀寫 agent_configs KV                      │
│    ├─ ToolRegistry    我們定義的 tool()[](檔案/Bash/Windows)    │
│    ├─ DbAdapter       讀寫 agent_messages                        │
│    └─ EventBridge     AI SDK fullStream part → IPC push 適配      │
│                                                                │
│  ipc-handlers/agent.handlers.ts                                │
│    invoke: start / interrupt / config / list / new / fork ...  │
│    push:   stream / tool-use / tool-result / end / ask         │
└────────────────────────────────────────────────────────────────┘
                          ↕  IPC(不開 HTTP;只服務桌面端一個前端)
┌──────────── electron renderer(agent window,thin client)──────┐
│                                                                │
│  Vue 殼(慢更新層)                                            │
│    AgentWindow.vue                                             │
│      ├─ AgentSidebar.vue   對話列表 / 新增 / 刪除 / fork        │
│      ├─ AgentTopbar.vue    標題 / provider·model / plan toggle │
│      ├─ AgentThread.vue    訊息列表外殼                        │
│      │     <MessageBubble> 外框 Vue 渲,內文 streaming vanilla  │
│      ├─ AgentInput.vue     輸入欄 + 貼附                       │
│      ├─ AgentSettingsDialog.vue                                │
│      └─ PermissionDialog.vue   工具請求許可的對話框             │
│                                                                │
│  Vanilla streaming 層(熱路徑)                                │
│    StreamingTextController / ToolCallController                │
│                                                                │
│  Pinia store(只放慢更新狀態,不存 streaming buffer)           │
└────────────────────────────────────────────────────────────────┘
```

> 為什麼 IPC 不 HTTP+SSE:opencode 用 HTTP+SSE 是為了「一份後端餵 TUI/web/VSCode 多個前端」。
> 我們只有桌面端一個前端 → IPC 最簡單、延遲最低、不開埠(內網也少一個攻擊面)。
> 若未來管理端(tmbomweb)也要連同一個 agent,再把 main 裡的 AgentRuntime 包一層 HTTP+SSE 即可 —
> 內核不變,只加一個傳輸適配。這是刻意保留的升級路徑,v2 不做。

---

## 3. 渲染層詳細設計

> 渲染層與編排內核解耦,**不因換 Vercel AI SDK 而變**。唯一銜接點是 §3.3 事件總線訂閱的 IPC push channel(由 §4.3
> EventBridge 從 AI SDK fullStream 適配)。

### 3.1 切割原則

| 屬性                          | Vue 管 | Vanilla 管 |
|-----------------------------|-------|-----------|
| 對話列表(增刪改 / fork)            | ✅     |           |
| 對話切換                        | ✅     |           |
| 訊息「存在/不存在」                  | ✅     |           |
| 訊息外框(role、頭像、時間)            | ✅     |           |
| 訊息**內文 streaming**          |       | ✅         |
| Markdown / 程式碼高亮(finalized) | ✅ 觸發  | ✅ 執行      |
| 工具卡片**外框 + 名稱**             | ✅     |           |
| 工具卡片**狀態徽章 / 即時輸出**         |       | ✅         |
| Permission 對話框              | ✅     |           |
| Plan mode chip              | ✅     |           |
| 設定 dialog                   | ✅     |           |

**判準**:「同一個 DOM 節點每秒會被改 > 5 次」→ vanilla 接管,其餘 Vue。

### 3.2 Controller pattern(Vue ↔ vanilla 銜接)

每個熱路徑區塊由一對組成:Vue component 提供 ref,Controller class 接管後續 DOM mutation。

```vue
<!-- MessageBubble.vue — 簡化示意 -->
<template>
  <div class="bubble" :class="['bubble--' + role]">
    <header><span>{{ roleLabel }}</span><time>{{ formattedTime }}</time></header>
    <!-- 這塊 div 是 vanilla 接管區,Vue 不管裡面 -->
    <div ref="contentRef" class="bubble__content"/>
    <ToolStripe :tool-calls="msg.toolCalls"/>
  </div>
</template>

<script setup lang="ts">
  const props = defineProps<{ msg: Message }>()
  const contentRef = ref<HTMLDivElement>()
  let controller: StreamingTextController | null = null
  onMounted(() => {
    if (!contentRef.value) return
    controller = new StreamingTextController(contentRef.value, props.msg.id)
    controller.bootstrap(props.msg.content)
  })
  onBeforeUnmount(() => controller?.dispose())
</script>
```

```ts
// streaming-text-controller.ts
export class StreamingTextController {
    private streamNode: HTMLPreElement | null = null
    private finalNode: HTMLDivElement | null = null
    private buf = ''
    private unsubs: Array<() => void> = []

    constructor(private root: HTMLElement, private messageId: string) {
        this.unsubs.push(
            agentEventBus.onStream(messageId, this.onDelta),
            agentEventBus.onEnd(messageId, this.onEnd),
        )
    }
    bootstrap(initial: string) { if (initial) this.renderFinal(initial) }

    private onDelta = (delta: string) => {
        if (!this.streamNode) {
            this.streamNode = document.createElement('pre')
            this.streamNode.className = 'streaming'
            this.root.appendChild(this.streamNode)
        }
        this.buf += delta
        this.streamNode.textContent = this.buf  // ⚡ 純 DOM,~0.05ms
    }
    private onEnd = () => {
        if (!this.streamNode) return
        this.renderFinal(this.buf)
        this.streamNode.remove(); this.streamNode = null
    }
    private renderFinal(text: string) {
        this.finalNode = document.createElement('div')
        this.finalNode.className = 'markdown-rendered'
        this.finalNode.innerHTML = sanitize(marked.parse(text))
        this.finalNode.querySelectorAll('pre code').forEach(el => hljs.highlightElement(el as HTMLElement))
        this.root.appendChild(this.finalNode)
    }
    dispose() {
        this.unsubs.forEach(u => u())
        this.streamNode?.remove(); this.finalNode?.remove()
    }
}
```

**保證點**:Vue 看不到 `streamNode` 的 textContent 變動,reactive 完全不觸發;`contentRef.value` 是 Vue 給的逃生口,出了這
div 還是 Vue 的世界;`dispose()` 跟 Vue lifecycle 對齊,無洩漏。

### 3.3 事件總線(`agentEventBus`)

```ts
class AgentEventBus extends EventTarget {
    constructor() {
        super()
        window.electronAPI.on(IpcChannels.AGENT_PUSH_STREAM, (payload) => {
            this.dispatchEvent(new CustomEvent('stream', {detail: payload}))
        })
        // tool-use / tool-result / end / permission-ask 同上
    }
    onStream(messageId: string, fn: (delta: string) => void): () => void {
        const handler = (e: Event) => {
            const {messageId: id, delta} = (e as CustomEvent).detail
            if (id === messageId) fn(delta)
        }
        this.addEventListener('stream', handler)
        return () => this.removeEventListener('stream', handler)
    }
}
export const agentEventBus = new AgentEventBus()
```

**為什麼用 EventTarget 而非 Pinia subscribe**:零依賴、零 reactive 開銷,過濾邏輯手寫明確。

### 3.4 Pinia store 職責收斂

```ts
export const useAgentStore = defineStore('agent', () => {
    // ✅ 慢更新狀態
    const conversations = ref<ConversationSummary[]>([])
    const activeId = ref<string | null>(null)
    const messages = ref<Message[]>([])              // 結構,不含 streaming buffer
    const config = ref<AgentConfig | null>(null)
    const planMode = ref(false)
    const pendingPermission = ref<PermissionRequest | null>(null)
    // ❌ 不放 Pinia:streaming text buffer / tool 增量輸出 / 即時 token 計數
    return {...}
})
```

**規則**:Pinia 內每個 `ref` 的更新頻率 ≤ 1 次/秒。違反的搬去 vanilla controller。

---

## 4. 編排層詳細設計(Vercel AI SDK 整合)

### 4.1 模組結構

```
electron/main/agent/
├── runtime.ts             AgentRuntime 主類(跑 ToolLoopAgent / streamText)
├── model-provider.ts      依 config 組 model(createAnthropic / openai / openai-compatible)
├── session-manager.ts     對話持久化 / fork / resume(讀寫 messages)
├── db-adapter.ts          讀寫 agent_messages
├── permission-policy.ts   allow/ask/deny 決策 + doom_loop / external_directory 守衛
├── tools/                 我們定義的 tool()
│   ├── index.ts           組工具陣列 + 包 permission gate
│   ├── fs-tools.ts        read / write / edit / glob / grep
│   ├── bash-tool.ts       bash
│   ├── web-tools.ts       webfetch / websearch
│   └── win-tools.ts       open_app / screenshot / clipboard_*
├── event-bridge.ts        fullStream part → IPC push 適配
└── prompts.ts             預設 system prompt
```

### 4.2 Model provider(唯一入口:必須先配置端點 URL,**無任何預設 model**)

> **這是全設計中唯一刻意不學 opencode 的地方**。opencode 內建 provider 預設 + models.dev,
> 開箱就帶 model、有 key 就能跑;我們**不預設任何 provider / model** ——
> agent 在使用者「配置好端點 URL(+ API key)」之前一律**不可用**(UI 停用、引導去設定頁)。
> 配好 URL 後,從該端點動態拉 model 清單讓使用者選(OpenAI 相容標準 `GET {baseURL}/models`)。

```ts
// model-provider.ts — 一律走 OpenAI 相容端點,URL 由使用者配置
import {createOpenAICompatible} from '@ai-sdk/openai-compatible'

export function buildModel(cfg: AgentConfig) {
    if (!cfg.baseUrl) throw new AgentNotConfiguredError('尚未配置模型端點 URL')
    if (!cfg.model)   throw new AgentNotConfiguredError('尚未選擇 model')
    return createOpenAICompatible({name: 'ichia', apiKey: cfg.apiKey, baseURL: cfg.baseUrl})(cfg.model)
}

// 配好 URL 後拉可用 model 清單(設定頁下拉選單用;沒 URL 就沒清單)
export async function listModels(cfg: AgentConfig): Promise<string[]> {
    if (!cfg.baseUrl) return []
    const res = await fetch(`${cfg.baseUrl}/models`, {
        headers: cfg.apiKey ? {Authorization: `Bearer ${cfg.apiKey}`} : {},
    })
    const {data} = await res.json()               // OpenAI 相容:{ data: [{id}, ...] }
    return (data ?? []).map((m: {id: string}) => m.id)
}

/** agent 是否已可用 = URL 與 model 都配好 */
export function isAgentReady(cfg: AgentConfig): boolean {
    return !!cfg.baseUrl && !!cfg.model
}
```

> 為什麼統一走 `@ai-sdk/openai-compatible`:公司 LiteLLM 代理 / 自架閘道 / 任何 OpenAI 相容端點
> 都吃這條;連 native anthropic/openai 也各有自己的 URL,一律當作「配置一個 URL」。
> 少一個 provider 分支,正好對齊「**只有配置 URL 才能用**」。

### 4.3 `AgentRuntime` 核心責任

```ts
import {ToolLoopAgent, stepCountIs} from 'ai'

class AgentRuntime {
    private current: { conversationId: string; abort: AbortController } | null = null

    async start(opts: StartOpts): Promise<void> {
        if (this.current) this.current.abort.abort()       // 新請求覆蓋舊的
        const abort = new AbortController()
        this.current = {conversationId: opts.conversationId, abort}

        const cfg = await this.configStore.read()
        const history = await this.session.loadMessages(opts.conversationId)  // resume:歷史 messages

        const agent = new ToolLoopAgent({
            model: this.modelProvider.build(cfg),
            system: cfg.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
            tools: this.tools.build(cfg, {planMode: opts.planMode}),  // 已包 permission gate(§5)
            stopWhen: stepCountIs(cfg.maxTurns ?? 20),                // agentic 迴圈上限
        })

        try {
            const result = agent.stream({
                messages: [...history, {role: 'user', content: opts.userMessage}],
                abortSignal: abort.signal,
            })
            for await (const part of result.fullStream) {
                await this.eventBridge.handle(part, opts.conversationId)  // → IPC push + DB
            }
            await this.session.append(opts.conversationId, await result.response) // 落 DB
        } catch (err) {
            if (!abort.signal.aborted) this.eventBridge.pushError(opts.conversationId, err)
        } finally {
            this.current = null
        }
    }

    interrupt(conversationId: string): boolean {
        if (this.current?.conversationId !== conversationId) return false
        this.current.abort.abort(); return true
    }
}
```

> 要逐步細控(例如每步注入不同 system、動態換 model)時,把 `ToolLoopAgent` 換成
> `streamText({model, messages, tools, stopWhen: stepCountIs(N), prepareStep})` — 同樣的 `fullStream`。

### 4.4 `EventBridge`(AI SDK fullStream part → IPC / DB)

`fullStream` 逐一 yield typed part,對映:

| AI SDK fullStream part   | IPC Push                    | DB action                  |
|--------------------------|-----------------------------|----------------------------|
| `text-start`             | —                           | 建 placeholder row          |
| `text-delta`(`.text`)    | `agent:push:stream`         | in-memory buffer           |
| `reasoning-delta`        | `agent:push:thinking`       | in-memory buffer           |
| `tool-call`              | `agent:push:tool-use`       | 寫 toolCalls 欄位             |
| `tool-result`            | `agent:push:tool-result`    | 寫 role='tool' 訊息           |
| `finish-step` / `finish` | `agent:push:end`            | commit content + reasoning |
| `error`                  | `agent:push:error`          | log                        |
| (permission gate 內需問使用者) | `agent:push:permission-ask` | —                          |

> 工具的即時增量輸出(例如 bash 邊跑邊回)由該 tool 的 `execute` 內主動推 `agent:push:tool-result`(增量),不經 fullStream。

---

## 5. Permission 模型(借 opencode 的宣告式配置)

> **AI SDK 無內建權限系統**。我們用 opencode 那套**宣告式配置**,落地方式是「**包一層 `tool.execute`**」的 gate:
> 每個工具真正執行前,先過 `PermissionPolicy.decide()`,回 allow 就執行、deny 就回一個「被拒絕」的
> tool result 給模型(模型看到後改走別的路,而非整個中斷)、ask 就推對話框 await 使用者。

### 5.1 宣告式配置(對齊 opencode)

```jsonc
{
  "permission": {
    "*": "ask",                       // 全域預設:沒被更具體規則命中就問
    "read":  "allow",
    "glob":  "allow",
    "grep":  "allow",
    "edit":  "ask",                   // 寫類預設問
    "write": "ask",
    "bash": {                         // 逐工具再用 glob 細分
      "*": "ask",
      "git status": "allow",
      "git *": "allow",
      "rm *": "deny",
      "format *": "deny"
    },
    "external_directory": "ask",      // 路徑出 workspace → 問(取代手寫路徑白名單比對)
    "webfetch": "allow"
  }
}
```

**規則語義**(照 opencode):

- 三態:`allow`(直接執行)/ `ask`(彈框)/ `deny`(擋,回拒絕結果)。
- glob:`*` 配零或多字元、`?` 配一字元;`~/x`、`$HOME/x` 展開家目錄。
- **最後命中者贏**(規則按序比對,最後一條命中的生效)。

### 5.2 決策 + 落地

```ts
// permission-policy.ts(示意)
decide(tool: string, input: unknown): 'allow' | 'ask' | 'deny' {
    // 1. 硬編碼系統防線最優先(使用者刪不掉,見 §5.4)
    if (this.hitsHardDeny(tool, input)) return 'deny'
    // 2. doom_loop:同一 (tool+input) 連續重複 N 次 → 擋(防燒錢打轉)
    if (this.isDoomLoop(tool, input)) return 'deny'
    // 3. external_directory:檔案類工具路徑正規化後出 workspace → 套 external_directory 規則
    // 4. 宣告式配置比對(最後命中者贏)
    return this.matchConfig(tool, input)
}

// tools/index.ts — 包 gate
function gate(name: string, t: Tool): Tool {
    return {...t, execute: async (args, o) => {
        const v = this.policy.decide(name, args)
        if (v === 'deny') return {denied: true, reason: `操作被安全策略拒絕:${describe(name, args)}`}
        if (v === 'ask') {
            const ok = await this.askUser(name, args)   // 推 permission-ask,await AGENT_PERMISSION_RESPOND
            if (!ok.allow) return {denied: true, reason: '使用者拒絕了此操作'}
            if (ok.persist) this.configStore.addRule(name, ok.pattern, 'allow')  // always → 追加 glob 規則
        }
        return t.execute!(args, o)
    }}
}
```

> `execute` 是 async,所以「彈框問使用者並等回應」天然支援。回「拒絕結果」而非 throw —
> 讓模型收到 reason 後能改走別條路,不會整輪崩掉(opencode 也這麼做)。

### 5.3 Permission 對話框 UX(對齊 Claude Code / opencode)

LLM 想跑 `git push origin main`:

```
┌──────────────────────────────────────────────────┐
│  Agent 要執行 Bash 命令                          │
│    git push origin main                           │
│  原因(LLM):同步本次修改到 remote               │
│  ┌──────────┐ ┌──────────────────┐              │
│  │ 允許本次  │ │ 永遠允許 git push │              │
│  ├──────────┤ ├──────────────────┤              │
│  │ 拒絕本次  │ │ 永遠拒絕 git push │              │
│  └──────────┘ └──────────────────┘              │
│  ▾ 進階:永遠允許前綴 [git push ] / 完整 / 自訂    │
└──────────────────────────────────────────────────┘
```

- **允許本次** = 放行一次,不寫配置
- **永遠允許 `git push`** = 往 `permission.bash` 追加 `"git push *": "allow"`
- **拒絕本次** = 回拒絕結果
- **永遠拒絕 `git push`** = 追加 `"git push *": "deny"`

**預設粒度** = 命令首兩詞(`git push`)。進階區可切完整精確 / 首詞 / 自訂 glob。

> ⚠️ 上圖是**開發者/管理員**視角(有「永遠」選項)。**終端使用者(工廠員工)只看到「允許本次 / 拒絕本次」兩顆**,
> 不出現「永遠」與進階區 —— 見 §5.6。

### 5.4 硬編碼系統防線(使用者刪不掉)

無論宣告式配置怎麼設,以下永遠 deny(寫死在 `HARDCODED_DENY` 常數,防誤操作 / prompt injection 兜底):

```
命令:rm / del / rmdir / rd / format / mkfs / shutdown / reboot / diskpart / >、>>(redirect)
路徑:C:\Windows、C:\Program Files(x86)、C:\Users\<u>\AppData、<userData>\app.db
```

### 5.5 預設配置(初始 seed 進 KV)

- 讀類(read/glob/grep/webfetch)`allow`;寫類(edit/write/bash)`ask`;`external_directory` `ask`。
- `bash` 內白名單前綴(`git status`/`git log`/`ls`/`cat`/`node -v`…)`allow`。
- 使用者可在設定頁(§5.6)增減,`always` 選擇也寫回這裡。

### 5.6 誰控管權限規則(**不對終端使用者開放**)

opencode 假設「使用者 = 開發者」,把權限開放給使用者自配。但本專案使用者是工廠員工、非開發者,
讓他們決定「AI 能不能跑 rm」既無意義也危險。故**刻意偏離 opencode**:

- **權限規則由開發者控管**:§5.1 的宣告式配置以 **JSON 寫在代碼/隨 app 出廠**(跟著 git 版控),
  **不做使用者管理頁**。安全預設 + 硬編碼 deny(§5.4)員工都動不了。
- **運行時彈框只給一次性**:員工看到的 §5.3 對話框**只有「允許本次 / 拒絕本次」**(針對眼前這個具體操作),
  **拿掉「永遠允許 / 永遠拒絕」**(持久化規則 = 權限管理,員工不該做)。
- 若將來有非技術管理員需在運行時調規則,再補一個表格編輯 UI —— v2 不做。

> 這也意味 §7.2 的 `agent.permission` 是**出廠預設**、非使用者可追加;§8 的 `AGENT_PERMISSION_RESPOND`
> 對終端使用者只回 `allow-once` / `deny-once`(`*-always` 與 `pattern` 持久化保留給開發者/後續管理員場景)。

---

## 6. 工具策略

> 工具用 AI SDK 的 `tool()` 定義(Zod `inputSchema`),放進 `tools` 物件傳給 agent。
> 全部經 §5.2 的 `gate()` 包一層才註冊。**無 MCP**(AI SDK 支援 MCP client,但我們的 Windows 工具是
> in-process,直接寫 `tool()` 更簡單,不引入 MCP)。
>
> ```ts
> import {tool} from 'ai'
> import {z} from 'zod'
> const readTool = tool({
>     description: '讀取檔案內容',
>     inputSchema: z.object({ path: z.string().describe('檔案路徑') }),
>     execute: async ({path}) => ({content: await readFileSafe(path)}),
> })
> ```

### 6.1 工具清單 + 預設權限

| 工具               | 動作分類(權限 key) | 預設        | 實作                |
|------------------|--------------|-----------|-------------------|
| `read`           | read         | allow     | 移植 opencode(fs)   |
| `write` / `edit` | write / edit | ask       | 移植 opencode(fs)   |
| `glob` / `grep`  | glob / grep  | allow     | 移植 opencode(fs)   |
| `bash`           | bash         | 命令層 ask   | 移植 opencode(bash) |
| `webfetch`       | webfetch     | allow     | 複用既有 WebFetch 能力  |
| `websearch`      | websearch    | allow(已開) | 視需要               |

> **工具實作移植自 opencode**(read/write/edit/glob/grep/bash)。opencode 是開源(SST,授權多為 MIT),
> 移植時**照授權在檔頭保留來源標註**;我們只在外面包一層 `tool()` + §5 的 permission `gate`,實作主體沿用它的。
> | `open_app`           | (自訂)             | ask | `exec('start ...')`       |
> | `screenshot`         | (自訂)             | allow(讀類)  | 走 `capture.service.ts`    |
> | `clipboard_read/write`| (自訂)            | 讀 allow/寫 ask | `electron.clipboard`     |

> 檔案類工具內部用 `agent.workspace` 當相對路徑錨點;路徑正規化成絕對路徑後,交給 §5 的
> `external_directory` 守衛判斷是否出界。

### 6.2 Plan mode(自建)

AI SDK 無內建 plan mode,自建兩層:

1. **工具子集**:plan 模式下 `tools.build(cfg, {planMode:true})` 只放唯讀工具(read/glob/grep/webfetch),模型物理上無法改檔。
2. **gate 兜底**:planMode 下對任何寫類工具一律 deny。

退出 plan → 下一輪用完整工具集重建 agent。UI 上是 plan mode chip。

### 6.3 Subagent

AI SDK 可用 `tool()` 內再開一個 `streamText` 跑子任務實現 subagent,但 **v2 不做**(需要時另開設計)。

---

## 7. DB 變更(只擴 KV)

### 7.1 `agent_messages` — 不動

現有欄位 `id / conversationId / role / content / reasoningContent / toolCalls / toolCallId / timestamp` 對應 AI SDK 的
`ModelMessage`(user/assistant/tool + content parts)。resume 時讀回組成 `messages` 傳入 agent。零 schema 變更。

### 7.2 `agent_configs` KV — 新增 keys

| Key                   | 型別            | 預設                            | 說明                                                        |
|-----------------------|---------------|-------------------------------|-----------------------------------------------------------|
| `llm.baseUrl`         | string        | **—(必填,無預設)**                 | 模型端點 URL(OpenAI 相容:LiteLLM 代理 / 自架 / 官方)。**沒它 agent 不可用** |
| `llm.model`           | string        | **—(無預設)**                    | model id;從 `llm.baseUrl` 的 `/models` 拉清單後選                |
| `llm.apiKey`          | string        | —                             | 端點 API key(明文落地,見 §9;有些自架端點可空)                            |
| `llm.systemPrompt`    | string        | (內建 default)                  | 自訂可覆蓋                                                     |
| `agent.maxTurns`      | number        | 20                            | `stopWhen: stepCountIs(n)` 的 n                            |
| `agent.planMode`      | boolean       | false                         | 啟動是否進 plan(§6.2)                                          |
| `agent.workspace`     | string        | `<userData>/agent-workspace/` | 檔案工具相對路徑錨點                                                |
| `agent.permission`    | object (JSON) | (§5.5 初始配置)                   | opencode 式宣告配置(`*` + 逐工具 + glob)                          |
| `agent.doomLoopLimit` | number        | 3                             | 同一 (tool+input) 連續重複幾次算打轉                                 |

> `agent.permission` 一個物件取代舊設計「path/bash × allow/deny × exact/prefix」8 個 key。
> 舊 key(`claude.*` / 分散的白黑名單)首次啟動走一次性 migrate:讀舊值合併進 `agent.permission`,刪舊 key。
> 系統硬編碼 deny(§5.4)**不進 KV**,寫死在程式碼。

### 7.3 conversation / session / fork

- 對話 = `agent_messages.conversationId` 隱式組成;`conversations` 不新增表。
- **fork**:複製某對話到某條訊息為止的 messages 成新 `conversationId`(對齊 opencode 的 session fork),UI 上是「從這裡分支」。

---

## 8. IPC 契約

```ts
// invoke
AGENT_START          { conversationId, userMessage, opts } → { messageId }
AGENT_INTERRUPT      { conversationId } → boolean
AGENT_LIST_MESSAGES  { conversationId, limit? } → Message[]
AGENT_LIST_CONVERSATIONS() → ConversationSummary[]
AGENT_NEW_CONVERSATION   { title? } → { conversationId }
AGENT_FORK_CONVERSATION  { conversationId, uptoMessageId } → { conversationId }
AGENT_DELETE_CONVERSATION{ conversationId } → boolean
AGENT_CONFIG_READ()  → AgentConfig            // 含 isReady:baseUrl+model 是否都配好
AGENT_CONFIG_WRITE   { partial } → boolean
AGENT_LIST_MODELS    { baseUrl, apiKey? } → { ok, models?: string[], error? }  // 拉端點 /models 供選
AGENT_PERMISSION_RESPOND { toolUseId, decision, pattern? } → boolean
AGENT_TEST_CONNECTION()  → { ok, error? }   // 對已配置的 URL+model 發極小 generateText 探針
// ⚠️ baseUrl / model 未配置時,AGENT_START 直接回錯誤引導去設定頁(agent 不可用)

// push (main → renderer)
AGENT_PUSH_STREAM    { conversationId, messageId, kind: 'text' | 'thinking', delta }
AGENT_PUSH_TOOL_USE  { conversationId, messageId, toolUseId, name, input }
AGENT_PUSH_TOOL_RESULT { conversationId, toolUseId, content, isError }
AGENT_PUSH_END       { conversationId, messageId, finishReason, finalContent }
AGENT_PUSH_PERMISSION_ASK { conversationId, toolUseId, tool, input, suggestedPattern }
AGENT_PUSH_ERROR     { conversationId, message }
```

`AGENT_PERMISSION_RESPOND` 的 `decision`:`allow-once` / `allow-always` / `deny-once` / `deny-always`;
`pattern`(僅 `*-always`)= 要寫進 `agent.permission` 的 glob。resolve 掉 main 端 `gate()` 裡 await 的 promise。

---

## 9. 安全 / 邊界(製造業內網場景)

| 面向             | 策略                                           | 取捨理由                               |
|----------------|----------------------------------------------|------------------------------------|
| 權限機制           | AI SDK 無內建 → gate 包 tool.execute,宣告式配置(§5)   | 控制權在我們,做企業想要的細粒度規則                 |
| API key        | DB 明文落地(同 saved_credentials)                 | 內網信任邊界,加密增複雜度但威脅模型不變               |
| Provider       | 多 provider(AI SDK),預設 Claude,可切 / 走代理        | 內網 LiteLLM 代理 / 自架就改 `llm.baseUrl` |
| 傳輸             | IPC,不開 HTTP 埠                                | 只服務桌面端,少一個攻擊面                      |
| 系統路徑 / 危險命令    | 硬編碼 deny(§5.4),使用者刪不掉                        | 防誤操作 / prompt injection 兜底         |
| 打轉燒錢           | `doom_loop` 守衛 + `stopWhen: stepCountIs(20)` | 防 LLM 卡死重複呼叫                       |
| Bash 寫操作       | 一律走 ask                                      | 防誤操作而非防惡意                          |
| Stream payload | 單 delta ≤ 4KB,tool-result ≤ 10KB             | 防卡死 IPC                            |
| 進程隔離           | 不做                                           | 內網信任邊界,過度工程                        |
| 操作追溯           | 所有 ask 決策都 log 到既有 logger                    | 出事可查(ops log,非 audit log)          |

**設計哲學**:**防誤操作 + 操作可追溯**。不假設使用者惡意 → 不做沙盒隔離、不加密 DB、permission 對話框優先「快速通過」(allow
once 是預設焦點)。

---

## 10. 落地階段

每階段都可獨立 revert。

### Stage 1 — AI SDK 接入(只動 main)

- `electron/main/agent/` 建立;`runtime.ts`(ToolLoopAgent)/ `model-provider.ts` / `db-adapter.ts` / `event-bridge.ts` 寫齊
- 先放最小工具集(read + bash 唯讀)跑通迴圈
- 新 IPC handler 註冊,舊 handler 並存;舊 Vue UI 改打新 IPC
- 設定頁流程:填**端點 URL(+ key)→ 拉 /models 清單 → 選 model → 測試連線**;
  未配置前 agent 入口停用、引導去設定
- **驗證**:未配 URL 時 agent 不可用且引導清楚;配好後多輪對話、abort、resume(灌歷史 messages)走通

### Stage 2 — Permission(宣告式配置 + gate)

- `permission-policy.ts`(decide + doom_loop + external_directory)+ `gate()` 包工具
- 初始配置 seed 進 KV;`PermissionDialog.vue` 渲染 ask
- IPC `AGENT_PUSH_PERMISSION_ASK` + `AGENT_PERMISSION_RESPOND` 通
- 設定頁做宣告式配置管理表格
- **驗證**:危險命令直接 deny;寫操作彈 ask;always 追加 glob 規則生效;doom_loop 攔得住

### Stage 3 — 完整工具集 + Windows 工具

- `fs-tools` / `bash-tool` / `web-tools` / `win-tools` 用 `tool()` 寫齊,移除 `agent-tool.service.ts`
- plan mode 工具子集接上
- **驗證**:讀寫 / screenshot / clipboard / open_app 正常;plan 模式無法寫檔

### Stage 4 — 渲染層拆分

- `StreamingTextController` / `ToolCallController`;`MessageBubble.vue` 接 controller;`agentEventBus` 起來;Pinia 拿掉
  streaming buffer
- **驗證**:100 token/s 流暢;切對話立即清乾淨

### Stage 5 — 切換 & 清理

- 新 IPC 取代舊;刪 `useAgentChat.ts` / `useAgentStream.ts` / 舊 `agent-tool.service.ts` / `fetch-providers.ts`;channel 名
  `agent2:*` → `agent:*`
- **驗證**:lint + typecheck + 端到端

### Stage 6 — 文件 & 灰度

- docs/08 補 agent_configs 新 keys;內部灰度 1 週再 GA

---

## 11. 不做的事(明確邊界)

| 項目                         | 為什麼不做                                                           |
|----------------------------|-----------------------------------------------------------------|
| HTTP+SSE 多客戶端後端            | 只服務桌面端;IPC 夠用。未來管理端要連再包一層 HTTP,內核不變(§2)                         |
| MCP                        | Windows 工具 in-process,`tool()` 直接寫更簡單(AI SDK 有 MCP client,備而不用) |
| 內建 plan mode / subagent 依賴 | AI SDK 無;plan 自建(§6.2),subagent v2 不做(§6.3)                     |
| Token 計費 / 用量儀表            | 內部用,無 billing;要看走 provider / 代理 console                         |
| 對話分享 / 匯出 / 搜尋             | 非核心;累積到上千筆再說                                                    |
| 整體去 Vue 化(主視窗)             | 主視窗 Vue 沒痛點                                                     |
| Audit log 級別紀錄             | 內網場景,既有 logger 落 SQLite 已足夠                                     |
| 沙盒進程隔離 / API key 加密        | 內網信任邊界,過度工程                                                     |

---

## 12. 名詞對照

| 用詞                  | 等價                                     | 說明                                                                          |
|---------------------|----------------------------------------|-----------------------------------------------------------------------------|
| 編排層 / Orchestration | Agent loop / Tool loop                 | LLM 呼叫 → 工具執行 → 回填 → 再 LLM                                                  |
| Vercel AI SDK       | `ai` + `@ai-sdk/*`                     | 本專案編排底座(opencode 同款)                                                        |
| ToolLoopAgent       | AI SDK v7 的 agent 類                    | 內建多步工具迴圈;要細控時用 `streamText`+`stopWhen`                                      |
| `tool()`            | AI SDK 工具定義                            | `{description, inputSchema(zod), execute}`                                  |
| gate                | 包一層 `tool.execute`                     | 我們的權限攔截點(AI SDK 無內建 hook)                                                   |
| fullStream          | AI SDK 串流事件流                           | typed parts:text-delta / tool-call / tool-result / reasoning-delta / finish |
| opencode 模式         | 無頭後端 + 薄 client + 宣告式權限 + session/fork | 借它的「怎麼組織 agent」,底座仍是 Vercel AI SDK                                          |
| 慢更新層                | Vue + Pinia                            | 人類動作頻率以下的 UI 變動                                                             |
| 熱路徑                 | streaming hot path                     | 亞秒級高頻 DOM mutation                                                          |
| Controller          | 純 TS class                             | 接管 Vue ref 後做 vanilla DOM 操作                                                |
| Workspace           | 檔案工具相對路徑錨點                             | 檔案工具內部使用 + external_directory 判界                                            |
| Session / fork      | 對話歷程 / 從某條訊息分支                         | 持久化到 SQLite,對齊 opencode                                                     |
| 內網信任邊界              | 公司內網 + 員工帳號 = 信任區                      | 安全設計的前提假設                                                                   |

---

## 附錄 — 既有 doc 對齊

| 既有 doc                | 處理                             |
|-----------------------|--------------------------------|
| ~~docs/14 / docs/17~~ | 已移除(舊 Agent v1 設計),本文為唯一現行設計   |
| docs/05-開發規範          | 仍有效,不動                         |
| docs/08-本地數據庫設計       | Stage 6 補 agent_configs 新 keys |

## 附錄 — 待確認(reviewer)

1. ~~預設 model~~ **已定案**:不預設任何 model,必須配置端點 URL 後從 `/models` 動態拉清單選(§4.2)。
2. ~~`websearch`~~ **已定案**:開,預設 allow。
3. ~~核心工具~~ **已定案**:移植 opencode 的 fs/bash 實作(照 MIT 授權保留來源標註)。
4. ~~設定頁權限管理~~ **已定案**:權限規則由開發者以 **JSON 出廠控管,不做使用者管理頁**;
   終端使用者運行時只有「允許本次 / 拒絕本次」(§5.6)。
