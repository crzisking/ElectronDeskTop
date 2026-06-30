# Agent v2 重寫設計 — pi (piagent) + Vue/Vanilla 混合渲染

> **本文取代 docs/14 與 docs/17 的「執行層 + 渲染層」核心設計**。
> v2 上線後 docs/14/17 標記為歷史脈絡,不再更新。
>
> **狀態**:設計階段(尚未開工),內容定稿後依 §10 分階段落地。
>
> **編排內核選型**:採用 **pi**(piagent,`https://github.com/earendil-works/pi`)。
> 早期版本曾規劃用 Claude Agent SDK(`@anthropic-ai/claude-agent-sdk`),後改為 pi —
> pi 是 TypeScript 寫的多 provider Agent 框架,核心兩個套件:
> `@earendil-works/pi-ai`(統一多 provider LLM API)+ `@earendil-works/pi-agent-core`
> (Agent 執行迴圈 / 工具呼叫 / 狀態管理)。改用 pi 帶來四個結構性差異(全文據此設計):
>   1. **原生多 provider**(anthropic / openai / google / xai / groq + 任意 OpenAI 相容 baseUrl),不綁單一生態。
>   2. **無內建權限系統** — pi 明言不限制檔案 / 進程 / 網路 / 憑證存取;權限由我們自己在 `beforeToolCall` 鉤子實作(
       反而更合本專案需求,見 §5)。
>   3. **無 MCP、無內建工具集** — 工具一律是我們定義的 `AgentTool` 物件,直接放進 `tools` 陣列(不需 MCP 層)。
>   4. **無內建 plan mode / subagent** — pi 哲學是「自己建或裝套件」;本專案 plan mode 自建(§6.3),subagent v2 不做。
>
> **使用情境**:本專案是製造業公司內部軟體,部署在公司內網的 Windows 桌面,
> 信任邊界 = 企業內網。安全設計以「**防誤操作 + 操作可追溯**」為主軸,
> 不假設使用者有惡意。設計選型(明文落地 API key、寬鬆 Pinia 暴露)
> 都在此前提下做的取捨,不要套用到面向消費者的場景。

---

## 0. TL;DR

```
─── 編排內核 ──────────────────────────────────────────
丟掉「自寫 OpenAI tool loop」,改用 pi(@earendil-works/pi-agent-core + pi-ai):
  - pi 跑在 main process(Node runtime,API key 不出 main)
  - pi-ai 統一多 provider:工具循環依賴的串流解析 / tool_call 拼裝 / 多 provider adapter 全砍掉
  - pi-agent-core 的 Agent 接手:agent loop、狀態、串流事件、parallel/sequential 工具執行、
    beforeToolCall / afterToolCall 鉤子
  - 工具(檔案 / Bash / Windows 特定)由我們定義成 AgentTool,放進 tools 陣列(無 MCP)
  - provider / model / baseURL 可設(支援公司 LiteLLM 代理 / 自架 OpenAI 相容端點)
  - DB schema 保留(agent_configs / agent_messages),只擴 KV key

─── 渲染策略 ──────────────────────────────────────────
不全丟 Vue,按**更新頻率**切兩半:
  - 慢更新(layout、sidebar、conversation 切換、設定 dialog)→ Vue + Pinia
  - 串流熱路徑(每秒幾十~上百 token、tool 卡片動態)→ vanilla DOM mutation
  - 銜接點:Controller pattern — Vue 提供 ref,內部由 class 直接動 DOM

─── Permission 模型 ──────────────────────────────────
pi 無內建權限 → 我們在 beforeToolCall 鉤子自建,對齊 Claude Code 的 allow/deny + once/always:
  - Bash:預設只放只讀命令,寫操作彈確認(allow once / always)
  - 路徑:預設只 workspace,跨目錄讀寫彈確認
  - 黑名單永遠拒絕(rm / format / shutdown ...),不問
  - 使用者選 "always" → 寫進 agent_configs KV,持久化
  - 設定頁可隨時撤回已記憶的規則
```

---

## 1. 為什麼要重寫

### 1.1 編排層的問題

現況 (`src/features/agent/composables/useAgentChat.ts` + `useAgentStream.ts`):

- 自寫 OpenAI streaming 解析 + tool_call accumulator + 多輪循環
- 沒有檔案操作工具的統一介面,Bash / Read / Write 都自寫 (`electron/main/services/agent-tool.service.ts` ~287 行)
- 每加一個 provider 要寫一份 adapter

**pi 接手後砍掉的**:

- `pi-ai` 提供統一多 provider LLM API(anthropic / openai / google / xai / groq / 自訂),
  串流解析、`toolCall` 累積、stop reason、thinking 區塊全由它處理 → 自寫 streaming parser + tool_call accumulator 全刪。
- `pi-agent-core` 的 `Agent` 提供 agent loop(LLM → 工具 → 回填 → 再 LLM)、訊息狀態、
  串流事件總線、`parallel` / `sequential` 工具執行、`beforeToolCall` / `afterToolCall` 鉤子 →
  自寫多輪循環 + 中斷邏輯全刪。
- 每個 provider 的 adapter → `getModel(provider, id)` 一行取代。

**pi 沒幫我們做、仍是我們的**(誠實邊界):

- pi-agent-core **不附帶** Read/Write/Edit/Bash/Glob/Grep 工具實作(那是 `pi-coding-agent` CLI 裡的,
  非公開可重用 API)。我們得自己把這些定義成 `AgentTool`(可參考 / 移植 pi-coding-agent 的實作)。
  但拿到的是乾淨的 `AgentTool` 介面 + 自動的工具呼叫拼裝 / 並行執行 / 前後鉤子,比現況的手寫循環省非常多。
- 權限策略(allow/deny/ask)是我們在 `beforeToolCall` 內自寫(pi 無內建,見 §5)。

淨效果:刪掉「provider 串流解析 + tool_call 拼裝 + 多輪循環 + per-provider adapter」整層(現況最脆弱、最易錯的部分),
工具實作改成標準化的 `AgentTool`,並免費獲得多 provider 能力。

### 1.2 渲染層的問題

現況 streaming token 走 Vue reactive 全鏈路:

- token delta → `assistantMsg.content +=` → Vue Proxy 觸發 → MessageRenderer 重渲 →
  parse-blocks 重切 → markdown 重 parse → highlight.js 重跑
- 即使 `useAgentStream.ts` 有 rAF 節流,在 100 token/s 速率下仍會偶發跳幀
- 工具卡片每次狀態更新(pending → executing → done)也走全鏈路

把 streaming 從 Vue 響應式拿掉,改純 DOM mutation,token 速率上限就只剩網路。

### 1.3 為什麼不全丟 Vue

Vue 在「真正需要結構性更新」的地方仍然是對的工具:對話列表、設定表單、訊息結構增刪、
多語/主題切換。這些更新頻率以「人類動作」為單位(秒級以下),Vue 的 overhead 完全可忽略。

**只有 token streaming 屬於亞秒級熱路徑**,需要脫出響應式。

---

## 2. 進程拓撲

```
┌────────────────────── electron main ──────────────────────┐
│                                                            │
│  AgentRuntime (single instance)                            │
│    ├─ pi Agent (@earendil-works/pi-agent-core)            │
│    │    new Agent({...}) / agent.prompt() / subscribe()    │
│    │    beforeToolCall / afterToolCall 鉤子                 │
│    ├─ pi-ai getModel(provider, id) — 多 provider / 自訂端點 │
│    ├─ SessionManager  conversationId ↔ agent.sessionId     │
│    ├─ PermissionPolicy 統一 allow/deny/ask 決策中心         │
│    │    (掛在 beforeToolCall 上,所有工具呼叫先過這層)       │
│    ├─ ConfigStore     讀寫 agent_configs KV                 │
│    ├─ ToolRegistry    我們定義的 AgentTool[](檔案/Bash/Win)│
│    ├─ DbAdapter       讀寫 agent_messages                   │
│    └─ EventBridge     pi event → IPC push 適配              │
│                                                            │
│  ipc-handlers/agent.handlers.ts                            │
│    invoke: start / interrupt / config / list / new / ...   │
│    push:   stream / tool-use / tool-result / end / ask     │
└────────────────────────────────────────────────────────────┘
                          ↕  IPC
┌──────────── electron renderer (agent window) ─────────────┐
│                                                            │
│  Vue 殼(慢更新層)                                        │
│    AgentWindow.vue                                         │
│      ├─ AgentSidebar.vue   對話列表 / 新增 / 刪除          │
│      ├─ AgentTopbar.vue    標題 / model / plan toggle      │
│      ├─ AgentThread.vue    訊息列表外殼                    │
│      │     v-for="msg of messages"                         │
│      │       <MessageBubble :id="msg.id" :role=...>        │
│      │         外框、頭像、時間 — Vue 渲                   │
│      │         內文 streaming — vanilla 接管(Controller)  │
│      ├─ AgentInput.vue     輸入欄 + 貼附                   │
│      ├─ AgentSettingsDialog.vue                            │
│      └─ PermissionDialog.vue   工具請求許可的對話框         │
│                                                            │
│  Vanilla streaming 層(熱路徑)                            │
│    StreamingTextController  訊息內文 token 累積             │
│    ToolCallController       工具卡片狀態 / 即時輸出         │
│                                                            │
│  Pinia store(只放慢更新狀態)                             │
│    conversations / activeId / messages / config            │
│    **不存 streaming buffer**,熱路徑由 controller 自己管    │
└────────────────────────────────────────────────────────────┘
```

---

## 3. 渲染層詳細設計

> 渲染層與編排內核解耦,**不因 Claude Agent SDK → pi 而變**。
> 唯一銜接點是 §3.3 的事件總線訂閱的 IPC push channel(由 §4.3 EventBridge 從 pi event 適配而來)。

### 3.1 切割原則

| 屬性                          | Vue 管 | Vanilla 管 |
|-----------------------------|-------|-----------|
| 對話列表(增刪改)                   | ✅     |           |
| Conversation 切換             | ✅     |           |
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
    <header>
      <span>{{ roleLabel }}</span>
      <time>{{ formattedTime }}</time>
    </header>
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

    bootstrap(initial: string) {
        if (initial) this.renderFinal(initial)
    }

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
        this.streamNode.remove()
        this.streamNode = null
    }

    private renderFinal(text: string) {
        this.finalNode = document.createElement('div')
        this.finalNode.className = 'markdown-rendered'
        this.finalNode.innerHTML = sanitize(marked.parse(text))
        this.finalNode.querySelectorAll('pre code')
            .forEach(el => hljs.highlightElement(el as HTMLElement))
        this.root.appendChild(this.finalNode)
    }

    dispose() {
        this.unsubs.forEach(u => u())
        this.streamNode?.remove()
        this.finalNode?.remove()
    }
}
```

**保證點**

- Vue 看不到 `streamNode` 的 textContent 變動,reactive 完全不觸發
- `contentRef.value` 是 Vue 給的「逃生口」,出了這個 div 還是 Vue 的世界
- Controller `dispose()` 跟 Vue lifecycle 對齊,沒記憶體洩漏

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
    // ✅ 慢更新狀態 — 走 Pinia
    const conversations = ref<ConversationSummary[]>([])
    const activeId = ref<string | null>(null)
    const messages = ref<Message[]>([])   // 結構,**不含 streaming buffer**
    const config = ref<AgentConfig | null>(null)
    const planMode = ref(false)
    const pendingPermission = ref<PermissionRequest | null>(null)  // 對話框觸發用

    // ❌ 不放 Pinia
    //   - streaming text buffer
    //   - tool execution incremental output
    //   - 即時 token 計數
    return {...}
})
```

**規則**:Pinia 內每個 `ref` 的更新頻率 ≤ 1 次/秒。違反這條規則的搬去 vanilla controller。

---

## 4. 編排層詳細設計(pi 整合)

### 4.1 模組結構

```
electron/main/agent/
├── runtime.ts             AgentRuntime 主類(持 pi Agent 實例)
├── session-manager.ts     conversationId ↔ agent.sessionId + messages 持久化
├── db-adapter.ts          讀寫 agent_messages
├── permission-policy.ts   allow/deny/ask 決策中心(掛在 beforeToolCall)
├── tools/                 我們定義的 AgentTool(無 MCP)
│   ├── index.ts           組工具陣列(依 config 決定開哪些)
│   ├── fs-tools.ts        read / write / edit / glob / grep
│   ├── bash-tool.ts       bash
│   └── win-tools.ts       open_app / screenshot / clipboard_*
├── event-bridge.ts        pi event → IPC push 適配
├── pi-config.ts           組 model(getModel / 自訂 baseUrl)+ Agent options
└── prompts.ts             預設 system prompt
```

> 對照舊設計:`sdk-config.ts → pi-config.ts`;`custom-tools.ts(in-process MCP)→ tools/(純 AgentTool)`。

### 4.2 `AgentRuntime` 核心責任

```ts
import {Agent, type AgentTool} from '@earendil-works/pi-agent-core'
import {getModel} from '@earendil-works/pi-ai'

class AgentRuntime {
    private current: { conversationId: string; agent: Agent } | null = null

    async start(opts: StartOpts): Promise<void> {
        if (this.current) this.current.agent.abort()  // 新請求覆蓋舊的

        const cfg = await this.configStore.read()
        const history = await this.db.listMessages(opts.conversationId)
        const lastSessionId = await this.session.sessionId(opts.conversationId)

        const agent = new Agent({
            initialState: {
                systemPrompt: cfg.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
                model: this.piConfig.buildModel(cfg),         // getModel(provider,id) 或自訂 baseUrl model
                thinkingLevel: cfg.thinkingLevel ?? 'off',
                tools: this.tools.build(cfg, {planMode: opts.planMode}), // 依 plan/權限決定開哪些
                messages: history,                            // resume:把歷史灌回
            },
            toolExecution: 'sequential',                      // 桌面端工具多有副作用,序列化保險
            beforeToolCall: this.permissionPolicy.onBeforeToolCall, // ← 權限攔截點(見 §5)
            afterToolCall: this.permissionPolicy.onAfterToolCall,   // 記錄 / 追溯
        })
        agent.sessionId = lastSessionId ?? agent.sessionId

        this.current = {conversationId: opts.conversationId, agent}

        // 訂閱 pi 事件 → 經 EventBridge 轉 IPC push + 落 DB
        const unsub = agent.subscribe((event, signal) =>
            this.eventBridge.handle(event, opts.conversationId))

        try {
            await agent.prompt(opts.userMessage)   // 跑完整個 agent loop(內含多輪工具)
            await agent.waitForIdle()
        } catch (err) {
            logger.error('agent run failed', 'AgentRuntime', err)
            this.eventBridge.pushError(opts.conversationId, err)
        } finally {
            unsub()
            await this.session.persist(opts.conversationId, agent.sessionId, agent.state.messages)
            this.current = null
        }
    }

    interrupt(conversationId: string): boolean {
        if (this.current?.conversationId !== conversationId) return false
        this.current.agent.abort()
        return true
    }
}
```

**對照舊 SDK 設計的關鍵差異**

| 舊(Claude Agent SDK)                   | 新(pi)                                                            |
|---------------------------------------|------------------------------------------------------------------|
| `query({prompt, options})` 回 async 迭代 | `new Agent({...})` + `agent.prompt(msg)` + `agent.subscribe(cb)` |
| `options.allowedTools`(白名單字串)         | 直接傳 `tools: AgentTool[]` — 沒列入 = 不存在,不需白名單                       |
| `options.permissionMode: 'plan'`      | 無內建;plan mode 自建(§6.3),靠 `tools` 子集 + beforeToolCall 攔寫          |
| `hooks.PreToolUse`                    | `beforeToolCall`(§5)                                             |
| `mcpServers`                          | 無 MCP;工具就是 `tools` 陣列的元素                                         |
| `resume: sessionId`                   | `agent.sessionId = ...` + `initialState.messages = 歷史`           |
| `abortSignal`                         | `agent.abort()`                                                  |

### 4.3 `EventBridge`(pi event → IPC / DB)

pi 事件(`agent.subscribe` 收到的)對映:

| pi Event                                                         | IPC Push                     | DB action                         |
|------------------------------------------------------------------|------------------------------|-----------------------------------|
| `message_start`(assistant)                                       | —                            | 建 placeholder row                 |
| `message_update` → `assistantMessageEvent.type='text_delta'`     | `agent:push:stream`          | in-memory buffer                  |
| `message_update` → `assistantMessageEvent.type='thinking_delta'` | `agent:push:thinking`        | in-memory buffer                  |
| `tool_execution_start`                                           | `agent:push:tool-use`        | 寫 toolCalls 欄位                    |
| `tool_execution_update`                                          | `agent:push:tool-result`(增量) | —(即時輸出走 onUpdate)                 |
| `tool_execution_end`                                             | `agent:push:tool-result`     | 寫 role='tool' 訊息                  |
| `message_end`(assistant)                                         | `agent:push:end`             | commit content + reasoningContent |
| `agent_end`                                                      | `agent:push:done`            | 更新 conversation sessionId         |
| (beforeToolCall 內需問使用者時)                                         | `agent:push:permission-ask`  | —                                 |

> 串流文字 / thinking 的增量在 pi-ai 層也有對應事件(`text_delta` / `thinking_delta` / `toolcall_*`),
> 但我們統一在 pi-agent-core 的 `Agent.subscribe` 這層接(它已把 LLM 串流 + 工具生命週期整合成單一事件流)。

---

## 5. Permission 模型(核心)

> **pi 無內建權限系統**(官方明言不限制檔案 / 進程 / 網路 / 憑證)。
> 這對本專案反而合適:我們本來就要自己定義路徑 / 命令的 allow/deny/ask,
> pi 提供的 **`beforeToolCall` 鉤子**正是統一攔截點 —— 每次工具呼叫前同步/非同步檢查,
> 回 `undefined` 放行、回 `{ block: true, reason }` 拒絕(LLM 會收到 reason)。

### 5.1 兩個獨立的安全邊界

| Config                        | 作用                         | pi 對應                 |
|-------------------------------|----------------------------|-----------------------|
| `agent.workspace`             | 相對路徑解析錨點 — 我們的檔案工具用它當 root | 我們自寫的 `fs-tools` 內部解析 |
| `agent.path.allow*` / `deny*` | 絕對路徑可達白名單 / 黑名單            | `beforeToolCall` 內自檢  |

**為什麼要拆**:pi 沒有 SDK 那種 `cwd` 概念,但**檔案工具是我們自己寫的**,
所以 workspace(相對路徑錨點)與可達邊界(絕對路徑白/黑名單)都由我們完全掌控:
工具參數拿到後,在 `beforeToolCall` 統一把路徑正規化成絕對路徑再比對白/黑名單。
LLM 想 `read({path:"C:\\Windows\\...\\hosts"})`,在 beforeToolCall 就被擋。

### 5.2 命令 / 路徑粒度

```
精確匹配  "git status"             完整字串
前綴匹配  "git "                   以此開頭都命中
萬用      "*"                      所有(只允許 deny 用)
```

精確 > 前綴(精確命中時前綴規則失效)。

### 5.3 決策流程

```
1. 黑名單命中(denyExact / denyPrefix) → block   ← 不問,直接拒絕
2. 白名單命中(allowExact / allowPrefix) → 放行(回 undefined)
3. 否則                                 → ask    ← 推 permission-ask 給 renderer,await 使用者回應
```

決策中心在 `permission-policy.ts` 的 `onBeforeToolCall`,**所有工具**(檔案 / Bash / Windows)都過這層。

```ts
// permission-policy.ts(示意)
onBeforeToolCall = async ({toolCall, args}: BeforeToolCallArgs) => {
    const verdict = this.decide(toolCall.name, args)   // 'allow' | 'deny' | 'ask'
    if (verdict === 'allow') return undefined
    if (verdict === 'deny') return {block: true, reason: `操作被安全策略拒絕:${describe(toolCall, args)}`}

    // ask:推對話框給 renderer,阻塞等使用者(beforeToolCall 是 async,可直接 await)
    const decision = await this.askUser(toolCall, args)  // resolve via AGENT_PERMISSION_RESPOND
    if (decision.persist) this.configStore.addRule(decision)  // always → 寫 KV
    return decision.allow ? undefined : {block: true, reason: '使用者拒絕了此操作'}
}
```

> `beforeToolCall` 是 async,所以「彈框問使用者並等回應」天然支援 —— 不需要像 SDK 那樣繞 hook 回傳協議。

### 5.4 Permission 對話框 UX(對齊 Claude Code)

LLM 想跑 `git push origin main`:

```
┌──────────────────────────────────────────────────┐
│  Agent 要執行 Bash 命令                          │
│  ──────────────────────────────────              │
│                                                   │
│    git push origin main                           │
│                                                   │
│  原因(LLM):同步本次修改到 remote               │
│                                                   │
│  ┌──────────────┐  ┌────────────────────┐       │
│  │  允許本次     │  │ 永遠允許 git push  │       │
│  └──────────────┘  └────────────────────┘       │
│  ┌──────────────┐  ┌────────────────────┐       │
│  │  拒絕本次     │  │ 永遠拒絕 git push  │       │
│  └──────────────┘  └────────────────────┘       │
│                                                   │
│  ▾ 進階                                           │
│    永遠允許前綴: [git push      ]                 │
│    永遠允許完整: git push origin main             │
└──────────────────────────────────────────────────┘
```

**四個主按鈕**:

1. **允許本次** — 放行一次,不寫 KV
2. **永遠允許 `git push`** — 寫 `allowPrefix` + `"git push "`
3. **拒絕本次** — LLM 收到「user denied」訊息(beforeToolCall 回 `{block, reason}`)
4. **永遠拒絕 `git push`** — 寫 `denyPrefix` + `"git push "`

**預設粒度** = 命令首兩個詞(`git push`)。對齊 Claude Code 的甜蜜點:不會太寬(只看首詞會把 `git pull` 也吃進來)、不會太窄(
完整字串無法泛化)。

**進階區**(可摺疊):切換成完整精確 / 切換成單詞首詞 / 自訂 prefix。

### 5.5 預設黑白名單

#### Bash:初始白名單(只放讀類)

`allowPrefix`:

```
git status   git log    git diff    git branch   git show    git remote   git fetch
ls           dir        type        cat
where        which
echo         pwd
whoami       hostname   ver
findstr      grep       wc          head        tail
env          set
node -v      npm -v     git --version
tasklist
```

#### Bash:初始黑名單(**永遠拒絕,不問**)

`denyPrefix`:

```
rm           del        rmdir       rd
format       mkfs
shutdown     reboot     halt
diskpart
curl http    wget       Invoke-WebRequest
>            >>          (粗暴擋 redirect,避免繞 deny)
```

#### 路徑:初始

```
agent.path.allowPrefix:
  - <agent.workspace>   (預設 userData/agent-workspace/)

agent.path.denyPrefix:
  - C:\Windows
  - C:\Program Files
  - C:\Program Files (x86)
  - C:\Users\<u>\AppData      (擋 app 自身設定區)
  - <userData>\app.db          (擋自己的 DB)
```

### 5.6 路徑邏輯也走同樣的 allow/deny/ask

`read` / `write` / `edit` / `glob` / `grep` 工具的呼叫,在 `beforeToolCall` 內把路徑參數正規化後:

```
1. 命中 denyPrefix → block
2. 命中 allowPrefix → 放行
3. 否則 → ask
```

Read 風險低,使用者通常一次「永遠允許 `C:\Users\<u>\Documents\`」就解決 90% 場景。
Write / Edit 更敏感,UX 上 ask 對話框會強調「將寫入 / 修改檔案」、預設選項是「允許本次」而非「永遠允許」。

### 5.7 規則管理 UI(設定頁)

```
[Bash 命令]
  ─ 白名單
    ├─ git status       (前綴)   [移除]
    ├─ git log          (前綴)   [移除]
    └─ npm install      (精確)   [移除]
  ─ 黑名單(永遠拒絕)
    ├─ rm               (前綴)   [移除]
    └─ format           (前綴)   [移除]
    [+ 新增]

[路徑]
  ─ 工作目錄(workspace)
    [C:\Users\xxx\AppData\Roaming\ichia\agent-workspace ]  [瀏覽]
  ─ 白名單(額外允許)
    ├─ C:\Users\xxx\Documents\ichia-data    [移除]
    [+ 新增]
  ─ 黑名單
    ├─ C:\Windows                            [系統,不可移除]
    ├─ C:\Program Files                      [系統,不可移除]
    [+ 新增]
```

「系統,不可移除」的條目寫死在程式碼層級(`HARDCODED_DENY_PATHS` 常數),使用者刪不掉。
這是防誤操作 / 防 prompt injection 的最後一道兜底。

---

## 6. 工具策略

> pi-agent-core **不附帶**檔案 / Bash 工具,工具一律是我們定義的 `AgentTool` 物件。
> 結構(摘自 pi-agent-core):
>
> ```ts
> import {Type} from 'typebox'
> const readFileTool: AgentTool = {
>     name: 'read_file',
>     label: 'Read File',
>     description: "Read a file's contents",
>     parameters: Type.Object({ path: Type.String({description: 'File path'}) }),
>     executionMode: 'sequential',           // 可選
>     execute: async (toolCallId, params, signal, onUpdate) => {
>         onUpdate?.({content: [{type: 'text', text: '...'}], details: {}})  // 即時增量
>         return {content: [{type: 'text', text: content}], details: {path: params.path}}
>     },
> }
> ```

### 6.1 自寫的核心工具集(取代 SDK 內建)

| 工具              | 預設          | 走 ask 條件         | 實作來源                                  |
|-----------------|-------------|------------------|---------------------------------------|
| `read`          | ✅           | 路徑超出 allowPrefix | 自寫 `fs-tools`(可參考 pi-coding-agent 實作) |
| `write`         | ✅ + 預設 ask  | 任何寫操作預設都 ask     | 同上                                    |
| `edit`          | ✅ + 預設 ask  | 同上               | 同上                                    |
| `glob` / `grep` | ✅           | 路徑超出 allowPrefix | 同上                                    |
| `bash`          | ✅ + 命令層 ask | 走 §5.5 白/黑名單     | 自寫 `bash-tool`(`child_process`)       |
| `web_fetch`     | ✅           | 內網允許下不擋          | 自寫(複用既有 WebFetch 能力)                  |

> 工具實作可移植 / 參考 `pi-coding-agent` 的 read/write/edit/bash/grep/find,
> 但本專案以「自己定義 AgentTool、實作收斂在 `tools/`」為準(不依賴未公開的內部 export)。
> 每個工具的副作用攔截統一在 §5 的 `beforeToolCall`,工具本身只管做事、不管權限。

### 6.2 Windows 特定工具(也是 AgentTool,**無 MCP**)

把現有 `agent-tool.service.ts` 內 Windows 特定工具改寫成 `AgentTool`,直接放進 `tools` 陣列:

| 舊 tool                                                     | 新 AgentTool       | 實作                                        |
|------------------------------------------------------------|-------------------|-------------------------------------------|
| `open_app`                                                 | `open_app`        | `child_process.exec('start ...')`,走 ask   |
| `screenshot`                                               | `screenshot`      | 走現有 `capture.service.ts`,不走 ask(讀類)       |
| `clipboard_read`                                           | `clipboard_read`  | `electron.clipboard.readText()`,不走 ask    |
| `clipboard_write`                                          | `clipboard_write` | `electron.clipboard.writeText(...)`,走 ask |
| `read_file` / `write_file` / `list_files` / `exec_command` | ❌ 移除              | 由 §6.1 的 read/write/glob/bash 取代          |

> 對照舊設計:不再需要 in-process MCP server(`mcpServers`),自訂工具與核心工具一視同仁,
> 都是 `tools` 陣列裡的 `AgentTool`。少一層協議,少一層抽象。

### 6.3 Plan mode(自建)

pi 無內建 plan mode。本專案自建,兩個機制疊加:

1. **工具子集**:plan 模式下 `tools.build(cfg, {planMode:true})` 只放唯讀工具(read/glob/grep/web_fetch),
   不放 write/edit/bash → LLM 物理上無法改檔案。
2. **beforeToolCall 兜底**:即使誤放,beforeToolCall 在 planMode 下對任何寫類工具一律 `block`。

退出 plan → 重建 agent 的 `tools`(或下一輪 `prompt` 時用完整工具集)。UI 上是 §3.1 的 plan mode chip 切換。

### 6.4 Subagent

pi 無內建 subagent(官方:自己 spawn 或裝套件)。**v2 不做**。
未來若需要,可在某個 `AgentTool.execute` 內 `new Agent({...})` 跑一個子任務再回填結果 —— 屆時另開設計,不進 v2 範圍。

---

## 7. DB 變更(只擴 KV)

### 7.1 `agent_messages` — 不動

現有欄位 `id / conversationId / role / content / reasoningContent / toolCalls / toolCallId / timestamp`
對應 pi 的 `AgentMessage` 模型(role / content blocks / toolResult),resume 時把這些灌回 `initialState.messages`。零 schema
變更。

### 7.2 `agent_configs` KV — 新增 keys

> provider 無關化:舊規劃的 `claude.*` 改成 `llm.*`,多帶一個 `llm.provider`。

| Key                      | 型別              | 預設                            | 說明                                                  |
|--------------------------|-----------------|-------------------------------|-----------------------------------------------------|
| **LLM 連線**               |                 |                               |                                                     |
| `llm.provider`           | string          | `anthropic`                   | `anthropic`/`openai`/`google`/`xai`/`groq`/`custom` |
| `llm.model`              | string          | `claude-sonnet-4-20250514`    | model id(對應 `getModel(provider, id)`)               |
| `llm.apiKey`             | string          | —                             | 該 provider 的 API key(明文落地,見 §9)                     |
| `llm.baseUrl`            | string          | —                             | `custom`/OpenAI 相容時填(LiteLLM 代理 / 自架)               |
| `llm.api`                | string          | —                             | `custom` 時填,如 `openai-completions`                  |
| `llm.systemPrompt`       | string          | (內建 default)                  | 自訂可覆蓋                                               |
| `llm.thinkingLevel`      | string          | `off`                         | `off`/`minimal`/`low`/`medium`/`high`/`xhigh`       |
| **執行控制**                 |                 |                               |                                                     |
| `agent.maxTurns`         | number          | 20                            | 單次 prompt 最多 agentic turns(我們在迴圈/turn 計數自限)         |
| `agent.toolExecution`    | string          | `sequential`                  | `sequential`/`parallel`(桌面端工具有副作用,預設序列)             |
| `agent.planMode`         | boolean         | false                         | 啟動時是否進 plan(§6.3)                                   |
| **工作目錄 + 路徑邊界**          |                 |                               |                                                     |
| `agent.workspace`        | string          | `<userData>/agent-workspace/` | 檔案工具的相對路徑錨點                                         |
| `agent.path.allowExact`  | string[] (JSON) | `[]`                          | 精確路徑白名單                                             |
| `agent.path.allowPrefix` | string[] (JSON) | `[<workspace>]`               | 前綴路徑白名單                                             |
| `agent.path.denyExact`   | string[] (JSON) | `[]`                          | 精確路徑黑名單                                             |
| `agent.path.denyPrefix`  | string[] (JSON) | `[]`(SYSTEM 寫死)               | 前綴路徑黑名單;系統項硬編碼,不存 KV                                |
| **Bash 命令邊界**            |                 |                               |                                                     |
| `agent.bash.allowExact`  | string[] (JSON) | `[]`                          | 精確命令白名單                                             |
| `agent.bash.allowPrefix` | string[] (JSON) | (§5.5 初始集合)                   | 前綴命令白名單                                             |
| `agent.bash.denyExact`   | string[] (JSON) | `[]`                          | 精確命令黑名單                                             |
| `agent.bash.denyPrefix`  | string[] (JSON) | (§5.5 初始集合)                   | 前綴命令黑名單                                             |

舊 key(`apiKey` / `baseUrl` / `model` 或任何 `claude.*`)首次啟動走一次性 migrate:讀舊值寫 `llm.*`,刪舊 key。

### 7.3 conversation ↔ session

`agent.sessionId` 持久化走 KV `conv:<id>:sessionId`;訊息歷史走 `agent_messages.conversationId`,
resume 時讀回 → 灌進 `initialState.messages`,並 `agent.sessionId = <存的>`。不新增表。

---

## 8. IPC 契約

```ts
// invoke
AGENT_START          { conversationId, userMessage, opts } → { messageId }
AGENT_INTERRUPT      { conversationId } → boolean
AGENT_LIST_MESSAGES  { conversationId, limit? } → Message[]
AGENT_LIST_CONVERSATIONS() → ConversationSummary[]
AGENT_NEW_CONVERSATION   { title? } → { conversationId }
AGENT_DELETE_CONVERSATION{ conversationId } → boolean
AGENT_CONFIG_READ()  → AgentConfig
AGENT_CONFIG_WRITE   { partial } → boolean
AGENT_PERMISSION_RESPOND { toolUseId, decision, persist? } → boolean
AGENT_TEST_CONNECTION()  → { ok, error?, modelList? }   // 設定頁「測試連線」

// push (main → renderer)
AGENT_PUSH_STREAM    { conversationId, messageId, kind: 'text' | 'thinking', delta }
AGENT_PUSH_TOOL_USE  { conversationId, messageId, toolUseId, name, input }
AGENT_PUSH_TOOL_RESULT { conversationId, toolUseId, content, isError }
AGENT_PUSH_END       { conversationId, messageId, stopReason, finalContent }
AGENT_PUSH_PERMISSION_ASK { conversationId, toolUseId, kind, payload, suggestedPrefix }
AGENT_PUSH_ERROR     { conversationId, message }
```

`AGENT_PERMISSION_RESPOND` 的 `decision`:

- `allow-once` / `allow-always`
- `deny-once` / `deny-always`

`persist`(僅 `*-always` 時用)= 完整字串 / 自訂 prefix,寫進對應 KV。
renderer 的回應 resolve 掉 main 端 `beforeToolCall` 裡 await 的那個 promise(§5.3)。

> IPC 契約與舊 SDK 版本幾乎一致(渲染層不感知內核換成 pi);差別只在 main 端 EventBridge
> 的來源事件從 SDK event 換成 pi `agent.subscribe` event(§4.3)。

---

## 9. 安全 / 邊界(製造業內網場景)

| 面向             | 策略                                             | 取捨理由                                     |
|----------------|------------------------------------------------|------------------------------------------|
| 權限機制           | pi 無內建 → 全在 `beforeToolCall` 自建 allow/deny/ask | pi 把控制權交給我們,正好做企業內網想要的細粒度規則              |
| API key        | DB 明文落地(同 saved_credentials)                   | 內網信任邊界,加密增複雜度但威脅模型不變                     |
| Provider       | 多 provider(pi-ai),預設 Claude,可切 / 走代理           | 內網有 LiteLLM 代理 / 自架模型時改 `llm.baseUrl` 即可 |
| Workspace      | 預設 `userData/agent-workspace/`(可改)             | 跟 app data 同樹,備份 / 清理一起                  |
| 系統路徑保護         | `C:\Windows`、`C:\Program Files` 寫死 deny        | 防 LLM 誤操作 / prompt injection 撈系統檔        |
| App DB 保護      | `<userData>/app.db` 寫死 deny                    | 防 LLM 自爆                                 |
| Bash 寫操作       | 一律走 ask                                        | 防誤操作而非防惡意                                |
| Bash 危險命令      | 寫死 deny(rm / format / shutdown ...)            | 兜底                                       |
| 工具失控           | 自限 `maxTurns: 20`(turn 計數)+ `agent.abort()`    | pi 無硬上限,turn 數我們在迴圈自己數                   |
| Stream payload | 單 delta ≤ 4KB,tool-result ≤ 10KB               | 防卡死 IPC                                  |
| 進程隔離           | 不做(pi 建議容器化,但內網信任邊界下過度工程)                      | 以 beforeToolCall 規則 + 硬編碼 deny 為主防線      |
| 操作追溯           | 所有 ask 決策 + afterToolCall 都 log 到既有 logger     | 出事可查;不是 audit log,是 ops log              |

**設計哲學**:**防誤操作 + 操作可追溯**。不假設使用者惡意,所以不做沙盒進程隔離、不加密 DB、
permission 對話框設計優先「快速通過」(allow once 是預設焦點)而非「設下重重關卡」。
pi 把安全完全交給應用層,我們用 `beforeToolCall` + 硬編碼 deny 把這條防線做扎實。

---

## 10. 落地階段

每階段都可獨立 revert。

### Stage 1 — pi 接入(只動 main)

- `electron/main/agent/` 目錄建立
- `runtime.ts`(持 `Agent`)/ `pi-config.ts`(`getModel` / 自訂 baseUrl)/ `db-adapter.ts` / `event-bridge.ts` 寫齊
- 先放**最小工具集**(read / bash 唯讀)跑通 loop
- 新 IPC handler 註冊,舊 handler 並存
- 配合**舊 Vue UI** 跑通基本對話(舊 UI 改打新 IPC)
- 設定頁加 provider / model / baseUrl 欄位 + 「測試連線」
- **驗證**:多輪對話、abort、resume(灌歷史 messages)、切 provider / 自訂 baseUrl 走通

### Stage 2 — Permission 系統(beforeToolCall)

- `permission-policy.ts` 寫 allow/deny/ask 決策,掛上 `beforeToolCall`
- 初始黑白名單 seed 進 KV(只跑一次,跟 seed.ts 同層)
- `PermissionDialog.vue` 渲染 ask 對話框(Vue,結構簡單)
- IPC `AGENT_PUSH_PERMISSION_ASK` + `AGENT_PERMISSION_RESPOND` 通(resolve main 端 await)
- 設定頁加白/黑名單管理 UI
- **驗證**:Bash 危險命令直接 block;寫操作彈 ask;always 持久化;設定頁刪規則生效

### Stage 3 — 完整工具集 + Windows 工具(AgentTool)

- `tools/fs-tools.ts`(read/write/edit/glob/grep)、`bash-tool.ts`、`win-tools.ts`(screenshot/clipboard/open_app)
- 移除 `agent-tool.service.ts` 對應實作
- plan mode 工具子集(§6.3)接上
- **驗證**:檔案讀寫 / screenshot / clipboard / open_app 走新路徑都正常;plan 模式無法寫檔

### Stage 4 — 渲染層拆分

- `StreamingTextController` / `ToolCallController` 落地
- `MessageBubble.vue` 接 controller
- `agentEventBus` 起來
- Pinia store 把 streaming buffer 拿掉
- **驗證**:100 token/s 流暢不卡;切 conversation 立即清乾淨

### Stage 5 — 切換 & 清理

- 新 IPC 取代舊 IPC(channel 命名統一)
- 刪 `useAgentChat.ts` / `useAgentStream.ts` / 舊 `agent-tool.service.ts` / `fetch-providers.ts`
- 主 channel 名從 `agent2:*` 改回 `agent:*`
- **驗證**:lint + typecheck + 端到端

### Stage 6 — 文件 & 灰度

- 更新 docs/14、docs/17 標 deprecated,指向本文件
- 內部灰度 1 週,收問題單再 GA

---

## 11. 不做的事(明確邊界)

| 項目                          | 為什麼不做 / 改觀                                                 |
|-----------------------------|------------------------------------------------------------|
| ~~多 provider~~(已改為**要做**)   | pi-ai 原生支援,`getModel(provider,id)` + 自訂 baseUrl 免費獲得,反而是賣點 |
| MCP server                  | pi 不支援;自訂工具用原生 `AgentTool` 即可,不需要這層協議                      |
| 內建 plan mode / subagent 依賴  | pi 無;plan mode 自建(§6.3),subagent v2 不做(§6.4)               |
| Token 計費 / 用量儀表             | 內部用,無 billing 需求;真要看走 provider / 代理服務 console              |
| 對話分享 / 匯出                   | 不是核心痛點                                                     |
| 對話搜尋                        | 累積到上千筆再說                                                   |
| Web Components / Shadow DOM | 學習曲線 + 樣式痛點 不值                                             |
| 整體去 Vue 化(主視窗)              | 主視窗 Vue 沒痛點                                                |
| 動態註冊工具 / 權限矩陣               | 工具 < 15,硬編碼 `AgentTool` + KV 白名單足夠                         |
| Audit log 級別操作紀錄            | 內網場景,既有 logger 落 SQLite 已足夠                                |
| 沙盒進程隔離 / 容器化                | pi 建議容器化做硬隔離,但內網信任邊界下過度工程;以 beforeToolCall 規則為主防線          |
| API key 加密儲存                | 同上,內網信任邊界                                                  |

---

## 12. 名詞對照

| 用詞                  | 等價                              | 說明                                                   |
|---------------------|---------------------------------|------------------------------------------------------|
| 編排層 / Orchestration | Agent loop / Tool loop          | LLM 呼叫 → 工具執行 → 回填 → 再 LLM                           |
| pi                  | piagent(`earendil-works/pi`)    | TS 多 provider Agent 框架,本專案編排內核                       |
| pi-ai               | `@earendil-works/pi-ai`         | 統一多 provider LLM API(`getModel`/`stream`/`complete`) |
| pi-agent-core       | `@earendil-works/pi-agent-core` | `Agent` 類 + agent loop + 工具 + 鉤子                     |
| `AgentTool`         | 工具定義物件                          | `{name,label,description,parameters,execute}`        |
| `beforeToolCall`    | 工具執行前鉤子                         | 我們的權限攔截點;回 `{block,reason}` 拒、`undefined` 放行         |
| 慢更新層                | Vue + Pinia                     | 人類動作頻率以下的 UI 變動                                      |
| 熱路徑                 | streaming hot path              | 亞秒級高頻 DOM mutation                                   |
| Controller          | 純 TS class                      | 接管 Vue ref 後做 vanilla DOM 操作                         |
| Workspace           | 檔案工具的相對路徑錨點                     | 我們自寫的 fs 工具內部使用                                      |
| Allowed Paths       | 自寫絕對路徑白名單                       | 在 `beforeToolCall` 攔截                                |
| Session             | `agent.sessionId` + messages    | 對話的可 resume 歷程,持久化到 SQLite                           |
| 內網信任邊界              | 公司內網 + 員工帳號 = 信任區               | 安全設計的前提假設                                            |

---

## 附錄 A — 既有 doc 對齊

| 既有 doc                   | 新地位                      | 處理                             |
|--------------------------|--------------------------|--------------------------------|
| docs/14-Agent功能設計.md     | 歷史脈絡                     | v2 上線後,文件首補一段「v2 之後參考 docs/19」 |
| docs/17-Agent訊息渲染系統設計.md | 歷史脈絡                     | 同上                             |
| docs/05-開發規範.md          | 仍然有效                     | 不動                             |
| docs/08-本地數據庫設計.md       | 補一段 agent_configs 新 keys | Stage 2 末更新                    |

## 附錄 B — 對 reviewer 的問題(尚待確認)

設計上已有取向,需要對齊的:

1. **`agent.workspace` 預設路徑**:用 `<userData>/agent-workspace/` 還是另外建 `~/Documents/ichia-agent/`?
    - 建議前者(跟 app data 一起備份/清理)
2. **預設 provider / model**:預設 `anthropic` + Claude Sonnet(pi 支援),還是預設走公司 LiteLLM 代理(`llm.baseUrl`)?
3. **核心工具實作**:自己從零寫 `fs-tools` / `bash-tool`,還是嘗試移植 `pi-coding-agent` 的實作?
    - 建議先自寫最小可用版(掌控度高、相依少),穩定後再評估移植
4. **`web_fetch` 預設開啟**:內網有沒有需要擋?
5. **設定頁是不是要把「規則管理」做成獨立子頁**(右側面板),還是擠在 dialog 內?
    - 建議獨立子頁(規則多了 dialog 滾不動)
6. **`AGENT_TEST_CONNECTION` 測試連線**:用 pi-ai 對選定 model 發一個極小 `complete()` 探針驗證 key/baseUrl 即可
