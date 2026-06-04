# Agent v2 重寫設計 — Claude Agent SDK + Vue/Vanilla 混合渲染

> **本文取代 docs/14 與 docs/17 的「執行層 + 渲染層」核心設計**。
> v2 上線後 docs/14/17 標記為歷史脈絡,不再更新。
>
> **狀態**:設計階段(尚未開工),內容定稿後依 §10 分階段落地。
>
> **使用情境**:本專案是製造業公司內部軟體,部署在公司內網的 Windows 桌面,
> 信任邊界 = 企業內網。安全設計以「**防誤操作 + 操作可追溯**」為主軸,
> 不假設使用者有惡意。設計選型(明文落地 API key、in-process MCP、寬鬆 Pinia 暴露)
> 都在此前提下做的取捨,不要套用到面向消費者的場景。

---

## 0. TL;DR

```
─── 編排內核 ──────────────────────────────────────────
丟掉「自寫 OpenAI tool loop」,改用 @anthropic-ai/claude-agent-sdk:
  - SDK 跑在 main process(Node runtime,API key 不出 main)
  - 工具循環、plan mode、subagent、permission 全由 SDK 接手
  - 自家 Windows 特定工具走 in-process MCP server
  - API 地址可設(支援公司 LiteLLM 代理 / Bedrock / Vertex)
  - DB schema 保留(agent_configs / agent_messages),只擴 KV key

─── 渲染策略 ──────────────────────────────────────────
不全丟 Vue,按**更新頻率**切兩半:
  - 慢更新(layout、sidebar、conversation 切換、設定 dialog)→ Vue + Pinia
  - 串流熱路徑(每秒幾十~上百 token、tool 卡片動態)→ vanilla DOM mutation
  - 銜接點:Controller pattern — Vue 提供 ref,內部由 class 直接動 DOM

─── Permission 模型 ──────────────────────────────────
對齊 Claude Code 的 allow/deny + once/always 四象限:
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
- 沒有 plan mode、沒有 subagent、沒有內建檔案操作
- Bash / Read / Write 都自寫 (`electron/main/services/agent-tool.service.ts` ~287 行)
- 每加一個 provider 要寫一份 adapter

Claude Agent SDK 提供:工具循環、plan mode、permission、subagent (Task)、
內建 Read/Write/Edit/Bash/Glob/Grep/WebFetch、MCP 擴充點。接 SDK 等於把以上代碼全砍掉,
保守估計減少 1000 行+ 自寫代碼。

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
│    ├─ Claude Agent SDK                                     │
│    │    query() / streaming events / permission callbacks  │
│    │    支援自訂 baseURL / authMethod (api-key/bedrock/...) │
│    ├─ SessionManager  conversationId ↔ SDK sessionId       │
│    ├─ PermissionPolicy 統一 allow/deny/ask 決策中心         │
│    ├─ ConfigStore     讀寫 agent_configs KV                 │
│    ├─ CustomMcpServer in-process MCP,Windows 特定工具       │
│    ├─ DbAdapter       讀寫 agent_messages                   │
│    └─ EventBridge     SDK event → IPC push 適配              │
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

## 4. 編排層詳細設計(Claude Agent SDK 整合)

### 4.1 模組結構

```
electron/main/agent/
├── runtime.ts             AgentRuntime 主類
├── session-manager.ts     conversationId ↔ SDK session 對映
├── db-adapter.ts          讀寫 agent_messages
├── permission-policy.ts   allow/deny/ask 決策中心(取代舊 tool-policy)
├── custom-tools.ts        in-process MCP server
├── event-bridge.ts        SDK event → IPC push 適配
├── sdk-config.ts          組 SDK options(baseURL/auth/model)
└── prompts.ts             預設 system prompt
```

### 4.2 `AgentRuntime` 核心責任

```ts
class AgentRuntime {
    private current: { conversationId: string; abort: AbortController } | null = null

    async start(opts: StartOpts): Promise<void> {
        if (this.current) this.current.abort.abort()  // 新請求覆蓋舊的
        const abort = new AbortController()
        this.current = {conversationId: opts.conversationId, abort}

        const lastSessionId = await this.db.lastSessionId(opts.conversationId)
        const cfg = await this.configStore.read()

        const stream = query({
            prompt: opts.userMessage,
            options: this.sdkConfig.build(cfg, {
                cwd: cfg.workspace,
                permissionMode: opts.planMode ? 'plan' : 'default',
                allowedTools: this.permissionPolicy.allowedToolNames(cfg),
                mcpServers: {local: this.customTools.server()},
                hooks: {PreToolUse: this.permissionPolicy.onToolUse},
                resume: lastSessionId ?? undefined,
                abortSignal: abort.signal,
            }),
        })

        try {
            for await (const event of stream) {
                await this.eventBridge.handle(event, opts.conversationId)
            }
        } catch (err) {
            if (!abort.signal.aborted) {
                logger.error('agent run failed', 'AgentRuntime', err)
                this.eventBridge.pushError(opts.conversationId, err)
            }
        } finally {
            this.current = null
        }
    }

    interrupt(conversationId: string): boolean { ...
    }
}
```

### 4.3 `EventBridge`

| SDK Event                   | IPC Push                    | DB action                         |
|-----------------------------|-----------------------------|-----------------------------------|
| `message_start` (assistant) | —                           | 建 placeholder row                 |
| `message_delta` (text)      | `agent:push:stream`         | in-memory buffer                  |
| `message_delta` (thinking)  | `agent:push:thinking`       | in-memory buffer                  |
| `tool_use_start`            | `agent:push:tool-use`       | 寫 toolCalls 欄位                    |
| `tool_use_result`           | `agent:push:tool-result`    | 寫 role='tool' 訊息                  |
| `message_stop` (assistant)  | `agent:push:end`            | commit content + reasoningContent |
| `result`                    | `agent:push:done`           | 更新 conversation lastSessionId     |
| (PreToolUse hook 內 ask)     | `agent:push:permission-ask` | —                                 |

---

## 5. Permission 模型(核心)

### 5.1 兩個獨立的安全邊界

之前文件混淆了「工作目錄」跟「可達邊界」,正式拆兩個 config:

| Config                        | 作用                     | SDK 對應              |
|-------------------------------|------------------------|---------------------|
| `agent.workspace`             | SDK 的 `cwd` — 相對路徑解析錨點 | `options.cwd`       |
| `agent.path.allow*` / `deny*` | 絕對路徑可達白名單 / 黑名單        | PreToolUse hook 內自檢 |

**為什麼要拆**:SDK 的 cwd **不會擋絕對路徑**。LLM 寫 `Read("C:\\Windows\\System32\\drivers\\etc\\hosts")`,
SDK 不會因為 cwd 不在那邊就拒絕。安全邊界必須我們自己在 PreToolUse 攔。

### 5.2 命令 / 路徑粒度

```
精確匹配  "git status"             完整字串
前綴匹配  "git "                   以此開頭都命中
萬用      "*"                      所有(只允許 deny 用)
```

精確 > 前綴(精確命中時前綴規則失效)。

### 5.3 決策流程

```
1. 黑名單命中(denyExact / denyPrefix) → deny  ← 不問,直接拒絕
2. 白名單命中(allowExact / allowPrefix) → allow
3. 否則                                 → ask  ← 彈對話框問使用者
```

決策中心在 `permission-policy.ts`,所有 SDK 內建工具 + 自訂 MCP 工具都過這層。

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
3. **拒絕本次** — LLM 收到「user denied」訊息
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

Read / Write / Edit / Glob / Grep 都走:

```
1. 命中 denyPrefix → deny
2. 命中 allowPrefix → allow
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

### 6.1 SDK 內建工具開哪些

| 工具                   | 預設          | 走 ask 條件                        |
|----------------------|-------------|---------------------------------|
| Read                 | ✅           | 路徑超出 allowPrefix                |
| Write                | ✅ + 預設 ask  | 任何寫操作預設都 ask                    |
| Edit                 | ✅ + 預設 ask  | 同上                              |
| Glob / Grep          | ✅           | 路徑超出 allowPrefix                |
| Bash                 | ✅ + 命令層 ask | 走 §5.5 白/黑名單                    |
| WebFetch / WebSearch | ✅           | 內網允許下不擋(後續按需要加限制)               |
| Task(subagent)       | ✅           | 不擋(subagent 內部呼叫的工具仍走同樣 policy) |
| TodoWrite            | ✅           | 不擋,UI 渲染 todos 側清單              |
| NotebookEdit         | ❌           | 用不到,allowedTools 不列入            |

### 6.2 自訂工具(in-process MCP)

把現有 `agent-tool.service.ts` 內 Windows 特定工具搬成 MCP tool:

| 舊 tool                                                     | 新 MCP tool        | 實作                                        |
|------------------------------------------------------------|-------------------|-------------------------------------------|
| `open_app`                                                 | `open_app`        | `child_process.exec('start ...')`,走 ask   |
| `screenshot`                                               | `screenshot`      | 走現有 `capture.service.ts`,不走 ask(讀類)       |
| `clipboard_read`                                           | `clipboard_read`  | `electron.clipboard.readText()`,不走 ask    |
| `clipboard_write`                                          | `clipboard_write` | `electron.clipboard.writeText(...)`,走 ask |
| `read_file` / `write_file` / `list_files` / `exec_command` | ❌ 移除              | SDK 內建 Read/Write/Glob/Bash 取代            |

MCP server 註冊走 `mcpServers: { local: server }`,**不另起進程**(in-process)。

---

## 7. DB 變更(只擴 KV)

### 7.1 `agent_messages` — 不動

現有欄位 `id / conversationId / role / content / reasoningContent / toolCalls / toolCallId / timestamp`
完整對應 SDK 訊息模型,零 schema 變更。

### 7.2 `agent_configs` KV — 新增 keys

| Key                      | 型別              | 預設                            | 說明                                 |
|--------------------------|-----------------|-------------------------------|------------------------------------|
| **API 連線**               |                 |                               |                                    |
| `claude.apiKey`          | string          | —                             | Anthropic / 代理服務 API key           |
| `claude.baseUrl`         | string          | `https://api.anthropic.com`   | 可改 LiteLLM / Bedrock / Vertex      |
| `claude.model`           | string          | `claude-sonnet-4-5`           | model id                           |
| `claude.authMethod`      | string          | `api-key`                     | `api-key` / `bedrock` / `vertex`   |
| `claude.systemPrompt`    | string          | (內建 default)                  | 自訂可覆蓋                              |
| **執行控制**                 |                 |                               |                                    |
| `agent.maxTurns`         | number          | 20                            | 單 query 最多 agentic turns           |
| `agent.permissionMode`   | string          | `default`                     | `default` / `acceptEdits` / `plan` |
| **工作目錄 + 路徑邊界**          |                 |                               |                                    |
| `agent.workspace`        | string          | `<userData>/agent-workspace/` | SDK cwd                            |
| `agent.path.allowExact`  | string[] (JSON) | `[]`                          | 精確路徑白名單                            |
| `agent.path.allowPrefix` | string[] (JSON) | `[<workspace>]`               | 前綴路徑白名單                            |
| `agent.path.denyExact`   | string[] (JSON) | `[]`                          | 精確路徑黑名單                            |
| `agent.path.denyPrefix`  | string[] (JSON) | `[]`(SYSTEM 寫死)               | 前綴路徑黑名單;系統項硬編碼,不存 KV               |
| **Bash 命令邊界**            |                 |                               |                                    |
| `agent.bash.allowExact`  | string[] (JSON) | `[]`                          | 精確命令白名單                            |
| `agent.bash.allowPrefix` | string[] (JSON) | (§5.5 初始集合)                   | 前綴命令白名單                            |
| `agent.bash.denyExact`   | string[] (JSON) | `[]`                          | 精確命令黑名單                            |
| `agent.bash.denyPrefix`  | string[] (JSON) | (§5.5 初始集合)                   | 前綴命令黑名單                            |

舊 key(`apiKey` / `baseUrl` / `model`)首次啟動走一次性 migrate:讀舊值寫新 key,刪舊 key。

### 7.3 `conversations` 表

不新增,沿用「`agent_messages.conversationId` 隱式組成」。`lastSessionId` 走 KV `conv:<id>:sessionId`。
真要 1000+ 對話再說。

---

## 8. IPC 契約

```ts
// invoke
AGENT_START
{
    conversationId, userMessage, opts
} → {
    messageId
}
AGENT_INTERRUPT
{
    conversationId
} → boolean
AGENT_LIST_MESSAGES
{
    conversationId, limit ?
} → Message[]
AGENT_LIST_CONVERSATIONS() → ConversationSummary[]
AGENT_NEW_CONVERSATION
{
    title ?
} → {
    conversationId
}
AGENT_DELETE_CONVERSATION
{
    conversationId
} → boolean
AGENT_CONFIG_READ() → AgentConfig
AGENT_CONFIG_WRITE
{
    partial
} → boolean
AGENT_PERMISSION_RESPOND
{
    toolUseId, decision, persist ?
} → boolean
AGENT_TEST_CONNECTION() → {
    ok, error ?, modelList ?
}
設定頁「測試連線」按鈕

// push (main → renderer)
AGENT_PUSH_STREAM
{
    conversationId, messageId, kind
:
    'text' | 'thinking', delta
}
AGENT_PUSH_TOOL_USE
{
    conversationId, messageId, toolUseId, name, input
}
AGENT_PUSH_TOOL_RESULT
{
    conversationId, toolUseId, content, isError
}
AGENT_PUSH_END
{
    conversationId, messageId, stopReason, finalContent
}
AGENT_PUSH_PERMISSION_ASK
{
    conversationId, toolUseId, kind, payload, suggestedPrefix
}
AGENT_PUSH_ERROR
{
    conversationId, message
}
```

`AGENT_PERMISSION_RESPOND` 的 `decision`:

- `allow-once` / `allow-always`
- `deny-once` / `deny-always`

`persist`(僅 `*-always` 時用)= 完整字串 / 自訂 prefix,寫進對應 KV。

---

## 9. 安全 / 邊界(製造業內網場景)

| 面向             | 策略                                      | 取捨理由                              |
|----------------|-----------------------------------------|-----------------------------------|
| API key        | DB 明文落地(同 saved_credentials)            | 內網信任邊界,加密增複雜度但威脅模型不變              |
| Workspace      | 預設 `userData/agent-workspace/`(可改)      | 跟 app data 同樹,備份 / 清理一起           |
| 系統路徑保護         | `C:\Windows`、`C:\Program Files` 寫死 deny | 防 LLM 誤操作 / prompt injection 撈系統檔 |
| App DB 保護      | `<userData>/app.db` 寫死 deny             | 防 LLM 自爆                          |
| Bash 寫操作       | 一律走 ask                                 | 防誤操作而非防惡意                         |
| Bash 危險命令      | 寫死 deny(rm / format / shutdown ...)     | 兜底                                |
| Subagent 遞迴    | `maxTurns: 20`                          | 避免失控                              |
| Stream payload | 單 delta ≤ 4KB,tool-result ≤ 10KB        | 防卡死 IPC                           |
| API 出站         | 預設 `api.anthropic.com`,可改               | 公司有 LiteLLM 代理就改代理,Bedrock 也行     |
| 操作追溯           | 所有 ask 決策都 log 到既有 logger 系統            | 出事可查;不是 audit log,是 ops log       |

**設計哲學**:**防誤操作 + 操作可追溯**。不假設使用者惡意,所以不做沙盒進程隔離、不加密 DB、
permission 對話框設計優先「快速通過」(allow once 是預設焦點)而非「設下重重關卡」。

---

## 10. 落地階段

每階段都可獨立 revert。

### Stage 1 — SDK 接入(只動 main)

- `electron/main/agent/` 目錄建立
- `runtime.ts` / `db-adapter.ts` / `event-bridge.ts` / `sdk-config.ts` 寫齊
- 新 IPC handler 註冊,舊 handler 並存
- 配合**舊 Vue UI** 跑通基本對話(舊 UI 改打新 IPC)
- 設定頁加 baseUrl / authMethod 欄位 + 「測試連線」
- **驗證**:多輪對話、abort、resume、自訂 baseUrl 走通

### Stage 2 — Permission 系統

- `permission-policy.ts` 寫 allow/deny/ask 決策
- 初始黑白名單 seed 進 KV(只跑一次,跟 seed.ts 同層)
- `PermissionDialog.vue` 渲染 ask 對話框(Vue,結構簡單)
- IPC `AGENT_PUSH_PERMISSION_ASK` + `AGENT_PERMISSION_RESPOND` 通
- 設定頁加白/黑名單管理 UI
- **驗證**:Bash 危險命令直接 deny;寫操作彈 ask;always 持久化;設定頁刪規則生效

### Stage 3 — 自訂工具走 MCP

- `custom-tools.ts` 包 4 個 Windows 工具成 MCP server
- 移除 `agent-tool.service.ts` 對應實作
- **驗證**:screenshot / clipboard / open_app 走新路徑都正常

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

| 項目                                 | 為什麼不做                                             |
|------------------------------------|---------------------------------------------------|
| 多 provider(OpenAI / DeepSeek / 文心) | 選 SDK 就擁抱 Anthropic 生態;baseUrl 可配已涵蓋 LiteLLM 代理場景 |
| Token 計費 / 用量儀表                    | 內部用,無 billing 需求;真要看走 Anthropic / 代理服務 console    |
| 對話分享 / 匯出                          | 不是核心痛點                                            |
| 對話搜尋                               | 累積到上千筆再說                                          |
| Web Components / Shadow DOM        | 學習曲線 + 樣式痛點 不值                                    |
| 整體去 Vue 化(主視窗)                     | 主視窗 Vue 沒痛點                                       |
| 動態註冊工具 / 權限矩陣                      | 工具 < 15,硬編碼 + KV 白名單足夠                            |
| Audit log 級別操作紀錄                   | 內網場景,既有 logger 落 SQLite 已足夠                       |
| 沙盒進程隔離                             | 內網信任邊界,過度工程                                       |
| API key 加密儲存                       | 同上                                                |

---

## 12. 名詞對照

| 用詞                  | 等價                        | 說明                           |
|---------------------|---------------------------|------------------------------|
| 編排層 / Orchestration | Agent loop / Tool loop    | LLM 呼叫 → 工具執行 → 回填 → 再 LLM   |
| 慢更新層                | Vue + Pinia               | 人類動作頻率以下的 UI 變動              |
| 熱路徑                 | streaming hot path        | 亞秒級高頻 DOM mutation           |
| Controller          | 純 TS class                | 接管 Vue ref 後做 vanilla DOM 操作 |
| Workspace           | SDK cwd                   | 相對路徑解析錨點                     |
| Allowed Paths       | 自寫絕對路徑白名單                 | 在 PreToolUse 攔截              |
| Session(SDK)        | conversation 的可 resume 歷程 | 對應 SDK `resume`              |
| Subagent            | SDK Task tool             | 把子任務丟給另一個 Claude 實例          |
| MCP server          | Model Context Protocol    | SDK 的工具擴充協議,in-process 用     |
| 內網信任邊界              | 公司內網 + 員工帳號 = 信任區         | 安全設計的前提假設                    |

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
2. **WebFetch / WebSearch 預設開啟**:內網有沒有需要擋?
3. **設定頁是不是要把「規則管理」做成獨立子頁**(右側面板),還是擠在 dialog 內?
    - 建議獨立子頁(規則多了 dialog 滾不動)
4. **`AGENT_TEST_CONNECTION` 測試連線**:打哪個 endpoint?`/v1/models`?
    - 看 baseUrl 對應的代理服務支援哪個。Anthropic 直連可用 `/v1/messages` 發小 dummy
