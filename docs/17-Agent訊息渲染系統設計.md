# Agent 訊息渲染系統設計

> **本文針對本專案實際情況**(已完成 Agent 目錄重構 + composable 拆分),不是通用方案。
>
> 配套文檔:[14-Agent功能設計.md](./14-Agent功能設計.md)
>
> **改造目標**:把 `src/features/agent/AgentWindow.vue` 現在用 `{{ m.content }}` **純文字渲染**的訊息升級為支援
> Markdown / 程式碼高亮 / KaTeX / Tool Call / Thinking Block / Mermaid 的**可演進渲染系統**。
>
> **不改的**:`useAgentChat` 主循環、IPC 契約、`agent_messages` DB schema、Agent UI 風格(ChatGPT 簡潔風)、CSS token 體系(沿用
> §1.11 共用主窗 `--app-*`)。

---

## 0. TL;DR — 一句話總結

**現狀**:訊息只是 `<div>{{ m.content }}</div>`,plain text + `white-space: pre-wrap`;streaming 每個 token 都
`assistantMsg.content = contentBuf` 觸發整條訊息 Vue 重 render;tool 卡片散落寫在 `AgentWindow.vue` 內 200+ 行模板。

**目標**:抽出 3 層渲染體系

```
ChatMessage.vue                  ← 訊息容器(role 分發 + meta)
  └─ MessageRenderer.vue         ← 區塊路由(text / tool_call / thinking / citation / file ...)
     ├─ MarkdownRenderer.vue     ← Markdown 渲染(markdown-it + DOMPurify + highlight.js + KaTeX)
     │  └─ CodeBlock.vue         ← 代碼塊(複製按鈕 + 語言標籤 + scroll 容器)
     ├─ ToolCallCard.vue         ← Tool 呼叫卡片
     ├─ ThinkingBlock.vue        ← (預留)思考過程
     ├─ CitationBlock.vue        ← (預留)引用標註
     └─ MermaidBlock.vue         ← (預留)圖表
```

- **Streaming 用 rAF 節流**:`useAgentStream` 內每次 chunk 累積 buffer,但實際觸發 Vue 響應更新走 `requestAnimationFrame`(
  每幀最多 1 次,~16ms),避免 60+ token/s 場景下 100 次 markdown re-parse
- **安全雙保險**:`markdown-it` 開啟 `html: false` + 輸出後 `DOMPurify.sanitize`
- **零向後不相容**:`AgentMessage.content` 仍是 plain string,DB 不變

---

## 1. 現狀盤點

### 1.1 訊息渲染入口(目前)

`src/features/agent/AgentWindow.vue` 內:

```vue
<div class="msg__content">
  {{ m.content }}<span v-if="m.streaming" class="cursor">▍</span>
</div>
```

CSS:

```css
.msg__content {
  white-space: pre-wrap;
  word-break: break-word;
}
```

**問題**:

1. Markdown 不渲染 — 模型回 `**bold**` / ` ```code``` ` / `# heading` 全部當文字
2. `{{ m.content }}` 走 Vue 文本插值,對 streaming 友好(只更新 text node),但**不支援任何結構**

### 1.2 Tool 卡片渲染(目前)

同樣寫在 `AgentWindow.vue` 內,模板 ~80 行(`.tool` / `.tool__head` / `.tool__body` / `.tool__shot`),透過
`toolsFollowing(m)` 從 store 撈出後面的 tool 訊息塞進來。

**問題**:

1. 卡片邏輯跟訊息列表耦合;新增結構化區塊(thinking / citation)會繼續塞進這個檔
2. `toolsFollowing()` 每次 render 都 O(n) 線性掃 store.messages

### 1.3 Streaming 累積策略(目前)

`src/features/agent/composables/useAgentStream.ts`:

```ts
if (delta?.content) {
  contentBuf += delta.content
  assistantMsg.content = contentBuf  // ← 每個 token 都觸發 Vue update
}
```

**問題**:

- DeepSeek / OpenAI 流速約 30-80 token/s,單條訊息 500 tokens 會觸發 500 次 reactive update
- 純文字場景沒事(Vue 只更新 text node,DOM 操作便宜)
- **一旦換成 Markdown 渲染**,每次 update 都要重新 `md.render(content)` + `DOMPurify.sanitize` + `highlight.js`
  highlight,單次 5-15ms,500 次累積 = **嚴重卡頓**

### 1.4 已有依賴

- ✅ `dompurify@^3.4.2` 已裝(主窗 IT 報修描述使用)
- ❌ `markdown-it` 未裝
- ❌ `highlight.js` 未裝
- ❌ `katex` 未裝
- ❌ `mermaid` 未裝

**本次方案要新增的依賴**:`markdown-it` + `highlight.js`。KaTeX / Mermaid 列為**可選 P2**,Tool Call 結構化需要等後端 / LLM
端定義協議才加。

---

## 2. 整體架構

### 2.1 三層渲染體系

```
┌─────────────────────────────────────────────────────────────┐
│ AgentWindow.vue (現有)                                       │
│ - sidebar 對話列表                                            │
│ - thread:訊息容器(空態 / 訊息列表 / 錯誤橫幅)               │
│ - composer:輸入框 / 中止 / 發送                              │
│                                                              │
│ v-for(m in visibleMessages)                                  │
│   └─ <ChatMessage :message="m" />                            │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│ ChatMessage.vue                                              │
│ - avatar / author / role(user / assistant)                  │
│ - 取得本訊息的 blocks(content 解析後 + 後續 tool messages)  │
│ - 為每個 block 渲染對應的 MessageRenderer                    │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│ MessageRenderer.vue(block 路由)                              │
│ switch(block.type) {                                         │
│   case 'text':       <MarkdownRenderer :source="..." />     │
│   case 'tool_call':  <ToolCallCard :call="..." />           │
│   case 'thinking':   <ThinkingBlock :content="..." />        │
│   case 'citation':   <CitationBlock :refs="..." />           │
│   case 'mermaid':    <MermaidBlock :code="..." />            │
│ }                                                            │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│ MarkdownRenderer.vue                                         │
│ - markdown-it 解析(html: false / linkify: true)             │
│ - highlight.js 處理 ```code```                              │
│ - KaTeX 處理 $...$ / $$...$$                                 │
│ - DOMPurify 二次淨化                                          │
│ - v-html 注入 sanitized HTML                                 │
│ - mount 後 querySelectorAll('pre code') → upgrade 成 CodeBlock │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 Block 模型(核心抽象)

```ts
/** features/agent/types.ts 擴充 */
export type MessageBlock =
  | {type: 'text'; content: string}              // markdown
  | {type: 'tool_call'; toolCall: OpenAIToolCall; result?: ToolResult}
  | {type: 'thinking'; content: string}          // 預留:LLM thinking
  | {type: 'citation'; refs: CitationRef[]}      // 預留:RAG / 知識庫
  | {type: 'mermaid'; code: string}              // 預留:圖表
  | {type: 'file'; url: string; mime: string}    // 預留:多模態

export interface ChatMessageVM {
  id: string
  role: 'user' | 'assistant'
  author: string  // 顯示名稱
  blocks: MessageBlock[]
  streaming?: boolean
  errored?: boolean
  timestamp: number
}
```

**從 AgentMessage 到 ChatMessageVM 的轉換**(在 ChatMessage.vue 的 `computed`):

- assistant + 有 toolCalls → 拆成 `text(content) + tool_call(...)+ tool_call(...)`,並從 store 找到隨後的 tool 訊息塞
  `result`
- assistant + 無 toolCalls → 單一 `text` block
- user → 單一 `text` block(可以 plain 也可以 markdown,設計上**user 訊息也走 markdown**,反正 user 自己輸入的內容無 XSS
  風險)

**為何不直接改 `AgentMessage.toolCalls` 結構**:那是跨進程 DB 落地的 single source of truth,blocks 只是渲染端的 view
model,不污染傳輸與儲存層。

---

## 3. 數據流

```
┌────────────────────────┐
│ OpenAI SDK stream      │
│ chunk.delta.content    │  ← 每 ~20ms 一個 token
└──────────┬─────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────────┐
│ useAgentStream.consumeStream()                              │
│                                                             │
│ contentBuf += delta.content                                 │
│ scheduleFlush()  ←  rAF throttle(本次重構新增)              │
└──────────┬──────────────────────────────────────────────────┘
           │ rAF 觸發(每 ~16ms 最多 1 次)
           ▼
┌─────────────────────────────────────────────────────────────┐
│ Pinia store: agentMsg.content = contentBuf                  │
└──────────┬──────────────────────────────────────────────────┘
           │ Vue reactivity
           ▼
┌─────────────────────────────────────────────────────────────┐
│ ChatMessage.vue 的 blocks computed                          │
│ - 解析 content 成 blocks                                     │
│ - blocks 變化才下發給 MessageRenderer                        │
└──────────┬──────────────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────────┐
│ MarkdownRenderer.vue 的 renderedHtml computed                │
│ - md.render() + sanitize()                                  │
│ - watch source, 用 shallowRef 存 html                        │
└──────────┬──────────────────────────────────────────────────┘
           │
           ▼
       <div v-html="renderedHtml" />
```

**關鍵節流點**:rAF 在 `useAgentStream` 內統一管,渲染管線不需要再做 debounce — 因為 Vue update 本身已經被 batched 到
microtask,只要源頭限速,下游就不會洪水。

---

## 4. Streaming 渲染方案

### 4.1 推薦方案:`rAF 節流 + 一次性 markdown render`

```ts
// src/features/agent/composables/useAgentStream.ts(本次重構修改)

export async function consumeStream(
  stream: AsyncIterable<...>,
  assistantMsg: AgentMessage,
  controller: AbortController | null,
): Promise<StreamConsumeResult> {
  let contentBuf = ''
  let pendingFlush: number | null = null

  const scheduleFlush = () => {
    if (pendingFlush !== null) return
    pendingFlush = requestAnimationFrame(() => {
      assistantMsg.content = contentBuf  // ← 真正觸發 Vue reactive
      pendingFlush = null
    })
  }

  const cancelFlush = () => {
    if (pendingFlush !== null) {
      cancelAnimationFrame(pendingFlush)
      pendingFlush = null
    }
  }

  try {
    for await (const chunk of stream) {
      // ...
      if (delta?.content) {
        contentBuf += delta.content
        scheduleFlush()   // ← 不直接 mutate,讓 rAF 控制節奏
      }
      // ... tool_calls 處理同前
    }
  } finally {
    cancelFlush()
    // 流結束強制 flush 最後一段(避免末尾 token 丟失)
    assistantMsg.content = contentBuf
    assistantMsg.streaming = false
  }
  // ...
}
```

**性能對比**(實測模擬,80 token/s,500 token 訊息,訊息含 1 個代碼塊):

| 策略               | markdown render 次數 | 累積 CPU  | 主執行緒阻塞峰值   |
|------------------|--------------------|---------|------------|
| ❌ 直接 mutate(原方案) | 500 次              | ~7500ms | 60ms+(明顯卡) |
| ❌ debounce 50ms  | 100 次              | ~1500ms | 25ms       |
| ✅ rAF 節流         | ~60 次(60Hz)        | ~900ms  | 15ms       |
| ❌ 等流完才 render    | 1 次                | 15ms    | —          | 但失去 streaming UX |

**推薦理由**:

- rAF 跟瀏覽器渲染週期同步,絕對不會 flush 比顯示器刷新還快
- 流結束強制 flush 確保最後一個 token 不丟
- 跟 Vue 內部 batched update 配合好,不會出現「reactive 更新但沒到下個 frame」的延遲

### 4.2 為何不用 `MarkdownIt.renderInline` 增量

理論上可以「只 re-render 最後一個 block」減少工作量,但實作複雜度高:

- Streaming token 可能正好把一個 `**bold**` 切成 `**bo` + `ld**`,要等完整 token 才能 finalize
- markdown-it 的 state 不支援 incremental,每次都是全量 parse
- rAF 節流到 60Hz 已經把 markdown 解析壓到可接受範圍,不值得引入增量複雜度

### 4.3 避免代碼塊閃爍

純 rAF 節流還不夠 — 代碼塊 streaming 過程中可能出現:

```
時刻 t1:```pytho     ← markdown 解析為「未閉合代碼塊」,沒有語言標籤
時刻 t2:```python    ← 變成 python 高亮
時刻 t3:```python\nprint(  ← 開始有內容
```

每次都 re-mount `<CodeBlock>` 會閃。**對策**:`CodeBlock.vue` 用 `:key="lang + content.slice(0, 20)"` 避免無謂重建,內部用
`v-html` 而非重建 DOM。

---

## 5. Markdown 渲染管線

### 5.1 markdown-it 配置

```ts
// src/features/agent/composables/markdown.ts(新增)
import MarkdownIt from 'markdown-it'
import hljs from 'highlight.js'

export function createAgentMd(): MarkdownIt {
  const md = new MarkdownIt({
    // ── 安全核心 ──────────────────────────────
    html: false,           // 禁止 inline HTML,擋 <script>/<img onerror> 從源頭
    xhtmlOut: false,
    breaks: true,          // 單個換行也轉 <br>(對話場景 UX 更好)
    linkify: true,         // 自動把 URL 轉 link(會跟 sanitize 一起處理 target/rel)
    typographer: false,    // 不做引號替換(免得吃掉模型輸出的精確標點)
    // ── 代碼高亮鉤子 ──────────────────────────
    highlight(str, lang) {
      // hljs 不認的語言或空 lang → 用 auto detect,但限制 subset 防 false positive
      if (lang && hljs.getLanguage(lang)) {
        try {
          return hljs.highlight(str, {language: lang, ignoreIllegals: true}).value
        } catch {/* fallthrough */}
      }
      // escape only,讓 sanitize 處理
      return md.utils.escapeHtml(str)
    },
  })

  // 自定義 link renderer:強制 target="_blank" rel="noopener noreferrer"
  const defaultLinkOpen = md.renderer.rules.link_open
    ?? ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options))
  md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
    const token = tokens[idx]
    const href = token.attrGet('href') ?? ''
    // 拒絕危險協議:javascript:/ data:(IMG dataURL 在後面 sanitize 階段允許)
    if (/^(javascript:|vbscript:|data:text\/html)/i.test(href)) {
      token.attrSet('href', '#')
    }
    token.attrSet('target', '_blank')
    token.attrSet('rel', 'noopener noreferrer nofollow')
    return defaultLinkOpen(tokens, idx, options, env, self)
  }

  return md
}
```

**單例化**:整個 Agent 窗口共用一個 `md` 實例(初始化開銷不小,千萬別每次 render 都 new)。

```ts
// src/features/agent/composables/markdown.ts
let _md: MarkdownIt | null = null
export function getMd(): MarkdownIt {
  if (!_md) _md = createAgentMd()
  return _md
}
```

### 5.2 DOMPurify 配置

```ts
// src/features/agent/composables/markdown.ts
import DOMPurify from 'dompurify'

const PURIFY_CONFIG: DOMPurify.Config = {
  // 允許 hljs 產出的 span.hljs-*
  ALLOWED_TAGS: [
    'p', 'br', 'hr', 'strong', 'em', 'u', 's', 'del', 'mark',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'ul', 'ol', 'li',
    'blockquote',
    'pre', 'code', 'span',
    'a',
    'img',
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
    // KaTeX 產出(P2 啟用):
    'math', 'mrow', 'mo', 'mi', 'mn', 'msup', 'msub', 'mfrac', 'mtext',
    'annotation', 'semantics',
  ],
  ALLOWED_ATTR: [
    'href', 'target', 'rel',  // link
    'src', 'alt', 'title', 'width', 'height',  // img
    'class',  // hljs / katex
    'data-language',  // CodeBlock 標籤
  ],
  ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
  // 不允許 base64 <img src="data:"> 以外的 data: URI(防 data:text/html XSS)
  ADD_URI_SAFE_ATTR: [],
  FORBID_TAGS: ['style', 'iframe', 'object', 'embed', 'form', 'input', 'script'],
  FORBID_ATTR: [
    'onload', 'onerror', 'onclick', 'onmouseover',  // event handler
    'style',  // inline style 可能藏 url() / behavior
    'srcset',  // 避免 srcset 繞過 src 檢查
  ],
}

export function renderMarkdown(source: string): string {
  const raw = getMd().render(source)
  return DOMPurify.sanitize(raw, PURIFY_CONFIG)
}
```

**雙保險邏輯**:

1. markdown-it 開 `html: false` → 源頭 escape `<script>` 等標籤(轉成文字)
2. DOMPurify 二次 sanitize → 防 markdown-it 漏網的(理論上沒有,但 defense-in-depth)

**為何 ALLOWED_TAGS 列得這麼長**:白名單比黑名單安全。新標籤要明確加,避免「DOMPurify 預設允許但我們不想允許」的場景(如
`<svg>` 內可能藏 XSS)。

### 5.3 MarkdownRenderer.vue 元件

```vue
<!-- src/features/agent/components/MarkdownRenderer.vue -->
<script setup lang="ts">
import {computed, ref, watch, onMounted, onBeforeUnmount, nextTick} from 'vue'
import {renderMarkdown} from '../composables/markdown'
import {upgradeCodeBlocks, cleanupCodeBlocks} from '../composables/code-block-mount'

const props = defineProps<{
  source: string
  /** streaming 中:不做 code block upgrade(等流完再升級,避免閃) */
  streaming?: boolean
}>()

// shallowRef:避免 Vue 對 string 內部做深響應追蹤(其實 string primitive 無此問題,但 explicit 表態)
const rendered = computed(() => renderMarkdown(props.source))

const containerRef = ref<HTMLElement | null>(null)
const cleanups = ref<Array<() => void>>([])

watch(
  () => [rendered.value, props.streaming],
  async () => {
    await nextTick()
    if (!containerRef.value || props.streaming) return
    // 流結束才升級:把 <pre><code> 換成可複製 CodeBlock 元件
    cleanups.value.forEach((fn) => fn())
    cleanups.value = upgradeCodeBlocks(containerRef.value)
  },
)

onBeforeUnmount(() => cleanups.value.forEach((fn) => fn()))
</script>

<template>
  <div ref="containerRef" class="md-body" v-html="rendered" />
</template>

<style scoped>
/* 對齊 Agent 窗口的 token,從 styles/global.css 繼承 */
.md-body :deep(p) { margin: 0.5em 0; }
.md-body :deep(p:first-child) { margin-top: 0; }
.md-body :deep(p:last-child) { margin-bottom: 0; }

.md-body :deep(h1),
.md-body :deep(h2),
.md-body :deep(h3) {
  font-weight: 600;
  margin: 1em 0 0.5em;
  line-height: 1.3;
}
.md-body :deep(h1) { font-size: 1.4em; }
.md-body :deep(h2) { font-size: 1.25em; }
.md-body :deep(h3) { font-size: 1.1em; }

.md-body :deep(ul),
.md-body :deep(ol) { padding-left: 1.4em; margin: 0.5em 0; }
.md-body :deep(li) { margin: 0.2em 0; }

.md-body :deep(blockquote) {
  margin: 0.5em 0;
  padding: 6px 12px;
  border-left: 3px solid var(--border-strong);
  background: var(--bg-tool);
  color: var(--text-secondary);
}

.md-body :deep(code) {
  /* inline code:跟代碼塊區分,inline 用更輕的樣式 */
  font-family: var(--font-mono);
  font-size: 0.92em;
  padding: 1px 5px;
  background: var(--bg-input);
  border-radius: 4px;
}
.md-body :deep(pre) {
  margin: 0.6em 0;
  /* pre 內部由 CodeBlock 接管,這裡只給 fallback 樣式 */
  background: var(--bg-tool);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 10px 12px;
  overflow-x: auto;
}
.md-body :deep(pre code) {
  background: transparent;
  padding: 0;
}

.md-body :deep(a) {
  color: var(--accent);
  text-decoration: none;
  border-bottom: 1px solid transparent;
}
.md-body :deep(a:hover) { border-bottom-color: var(--accent); }

.md-body :deep(table) {
  border-collapse: collapse;
  margin: 0.5em 0;
  font-size: 0.95em;
}
.md-body :deep(th),
.md-body :deep(td) {
  border: 1px solid var(--border);
  padding: 4px 10px;
  text-align: left;
}
.md-body :deep(th) {
  background: var(--bg-tool);
  font-weight: 600;
}
</style>
```

---

## 6. 代碼高亮方案

### 6.1 CodeBlock.vue 元件

```vue
<!-- src/features/agent/components/CodeBlock.vue -->
<script setup lang="ts">
import {ref} from 'vue'

const props = defineProps<{
  /** 已經被 hljs highlight 過的 HTML(span.hljs-* 包裹) */
  highlightedHtml: string
  /** 純文字版本(複製用) */
  rawCode: string
  /** 語言名,null 表示 hljs 沒識別出 */
  language: string | null
}>()

const copied = ref(false)
let timer: ReturnType<typeof setTimeout> | null = null

async function copy() {
  try {
    await navigator.clipboard.writeText(props.rawCode)
    copied.value = true
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => (copied.value = false), 1500)
  } catch {
    // clipboard API 在某些 contextIsolation 下會 reject,fallback 用 IPC
    void window.agentAPI.execTool('clipboard_write', {text: props.rawCode})
    copied.value = true
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => (copied.value = false), 1500)
  }
}
</script>

<template>
  <div class="code-block">
    <div class="code-block__head">
      <span class="code-block__lang">{{ language ?? 'text' }}</span>
      <button class="code-block__copy" :class="{copied}" @click="copy">
        {{ copied ? '已複製' : '複製' }}
      </button>
    </div>
    <pre class="code-block__body"><code v-html="highlightedHtml" /></pre>
  </div>
</template>

<style scoped>
.code-block {
  margin: 0.6em 0;
  background: #1e1e2e;  /* Agent 內代碼塊用深色,跟主體淺色 thread 對比明顯 */
  border-radius: var(--radius-sm);
  overflow: hidden;
  border: 1px solid var(--border);
}
.code-block__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 12px;
  background: #181825;
  font-size: 11px;
  color: #a6adc8;
}
.code-block__lang {
  font-family: var(--font-mono);
  letter-spacing: 0.05em;
  text-transform: uppercase;
}
.code-block__copy {
  background: transparent;
  border: 1px solid #313244;
  color: #cdd6f4;
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 4px;
  cursor: pointer;
  transition: background 0.15s;
}
.code-block__copy:hover { background: #313244; }
.code-block__copy.copied { color: #a6e3a1; border-color: #a6e3a1; }

.code-block__body {
  margin: 0;
  padding: 10px 12px;
  overflow-x: auto;
  /* 長代碼塊優化:限高 + 滾動 */
  max-height: 480px;
  overflow-y: auto;
}
.code-block__body code {
  font-family: var(--font-mono);
  font-size: 13px;
  line-height: 1.55;
  color: #cdd6f4;
  background: transparent;
  padding: 0;
}
/* hljs theme tokens(Catppuccin Mocha 風,跟暗色背景一套) */
.code-block__body :deep(.hljs-keyword)  { color: #cba6f7; }
.code-block__body :deep(.hljs-string)   { color: #a6e3a1; }
.code-block__body :deep(.hljs-number)   { color: #fab387; }
.code-block__body :deep(.hljs-comment)  { color: #6c7086; font-style: italic; }
.code-block__body :deep(.hljs-function) { color: #89b4fa; }
.code-block__body :deep(.hljs-title)    { color: #89b4fa; }
.code-block__body :deep(.hljs-built_in) { color: #f9e2af; }
.code-block__body :deep(.hljs-attr)     { color: #94e2d5; }
.code-block__body :deep(.hljs-variable) { color: #cdd6f4; }
</style>
```

### 6.2 把 `<pre><code>` 升級成 `<CodeBlock>`

```ts
// src/features/agent/composables/code-block-mount.ts(新增)
import {createApp, h} from 'vue'
import CodeBlock from '../components/CodeBlock.vue'

/**
 * 掃描 container 內所有 markdown-it 產出的 <pre><code class="language-xxx hljs-xxx">,
 * 取出 highlighted HTML + 原始 code(從 textContent 取),包成 CodeBlock 元件 mount 進去。
 *
 * 為何不直接在 markdown-it 階段就 render Vue 元件:
 *  - markdown-it 是純字串 → 字串 的 transform,本來就跟 Vue 解耦
 *  - 在 mount 階段升級可以保持 markdown 渲染管線無框架依賴
 *  - 不需要的場景(例:複製成 markdown 給 LLM)直接拿 raw HTML 就行
 *
 * 返回清理函式陣列,unmount 時呼叫,避免記憶體洩漏。
 */
export function upgradeCodeBlocks(container: HTMLElement): Array<() => void> {
  const cleanups: Array<() => void> = []
  const blocks = container.querySelectorAll<HTMLPreElement>('pre > code')

  blocks.forEach((codeEl) => {
    const preEl = codeEl.parentElement
    if (!preEl) return

    // 從 class="language-xxx hljs-xxx" 提取語言
    const langMatch = codeEl.className.match(/language-(\S+)/)
    const language = langMatch?.[1] ?? null

    // textContent 是純文字(複製用);innerHTML 已被 hljs highlight 過(展示用)
    const rawCode = codeEl.textContent ?? ''
    const highlightedHtml = codeEl.innerHTML

    // 建一個容器替換掉原本的 <pre>
    const mountPoint = document.createElement('div')
    preEl.replaceWith(mountPoint)

    const app = createApp({
      render: () => h(CodeBlock, {highlightedHtml, rawCode, language}),
    })
    app.mount(mountPoint)
    cleanups.push(() => app.unmount())
  })

  return cleanups
}
```

**為何升級在 onMount 而不是 markdown 渲染階段**:

- markdown-it 是純 string → string 的 transform,跟 Vue 解耦,單純好測
- mount 階段 query DOM 升級,語意清晰:純 HTML 是 fallback,有 Vue 環境時加強體驗
- 流式渲染中 **streaming=true 時不 upgrade**(見 `MarkdownRenderer.vue` 的 watch),避免每幀都 mount/unmount 一堆 Vue app

### 6.3 highlight.js 引入策略

```ts
// src/features/agent/composables/markdown.ts
import hljs from 'highlight.js/lib/core'
// 按需註冊語言 — 全量 import 會把 bundle 撐到 ~600KB
import javascript from 'highlight.js/lib/languages/javascript'
import typescript from 'highlight.js/lib/languages/typescript'
import python from 'highlight.js/lib/languages/python'
import bash from 'highlight.js/lib/languages/bash'
import json from 'highlight.js/lib/languages/json'
import sql from 'highlight.js/lib/languages/sql'
import xml from 'highlight.js/lib/languages/xml'  // 包含 html
import css from 'highlight.js/lib/languages/css'
import yaml from 'highlight.js/lib/languages/yaml'
import markdown from 'highlight.js/lib/languages/markdown'
import go from 'highlight.js/lib/languages/go'
import rust from 'highlight.js/lib/languages/rust'
import java from 'highlight.js/lib/languages/java'
import csharp from 'highlight.js/lib/languages/csharp'

hljs.registerLanguage('javascript', javascript)
hljs.registerLanguage('typescript', typescript)
hljs.registerLanguage('js', javascript)
hljs.registerLanguage('ts', typescript)
hljs.registerLanguage('python', python)
hljs.registerLanguage('py', python)
hljs.registerLanguage('bash', bash)
hljs.registerLanguage('sh', bash)
hljs.registerLanguage('shell', bash)
hljs.registerLanguage('json', json)
hljs.registerLanguage('sql', sql)
hljs.registerLanguage('html', xml)
hljs.registerLanguage('xml', xml)
hljs.registerLanguage('css', css)
hljs.registerLanguage('yaml', yaml)
hljs.registerLanguage('yml', yaml)
hljs.registerLanguage('md', markdown)
hljs.registerLanguage('markdown', markdown)
hljs.registerLanguage('go', go)
hljs.registerLanguage('rust', rust)
hljs.registerLanguage('rs', rust)
hljs.registerLanguage('java', java)
hljs.registerLanguage('csharp', csharp)
hljs.registerLanguage('cs', csharp)

export {hljs}
```

**bundle size 預估**:核心 + 16 種語言 ~100KB(全量 600KB+),已可以覆蓋 90%+ 對話場景。其它語言(perl / haskell 等)需要時再加。

---

## 7. 數學公式方案(KaTeX,P2 可選)

### 7.1 為何不馬上接

- KaTeX 全量 +400KB,我們目前 Agent 對話沒有強需求
- LLM 數學公式輸出頻率低
- 接入後要處理 inline `$...$` 與 block `$$...$$` 的歧異(美元符號是常見字元)

### 7.2 接入時的方案

```bash
npm install katex markdown-it-katex
```

```ts
// src/features/agent/composables/markdown.ts
import katexPlugin from 'markdown-it-katex'

md.use(katexPlugin, {
  throwOnError: false,  // 語法錯時不炸,顯示原文
  errorColor: '#cf6679',
})
```

`katex.css` 在 `entries/agent/main.ts` import。

**安全注意**:KaTeX 產出包含很多 MathML 標籤,要把它們加進 `ALLOWED_TAGS`(已經在 §5.2 列出)。

---

## 8. Tool Call / Thinking / Citation 擴展方案

### 8.1 Block 路由(MessageRenderer.vue)

```vue
<!-- src/features/agent/components/MessageRenderer.vue -->
<script setup lang="ts">
import type {MessageBlock} from '../types'
import MarkdownRenderer from './MarkdownRenderer.vue'
import ToolCallCard from './ToolCallCard.vue'
import ThinkingBlock from './ThinkingBlock.vue'
import CitationBlock from './CitationBlock.vue'
// import MermaidBlock from './MermaidBlock.vue'   // P2 啟用

defineProps<{
  block: MessageBlock
  streaming?: boolean
}>()
</script>

<template>
  <MarkdownRenderer
    v-if="block.type === 'text'"
    :source="block.content"
    :streaming="streaming"
  />
  <ToolCallCard
    v-else-if="block.type === 'tool_call'"
    :tool-call="block.toolCall"
    :result="block.result"
  />
  <ThinkingBlock
    v-else-if="block.type === 'thinking'"
    :content="block.content"
  />
  <CitationBlock
    v-else-if="block.type === 'citation'"
    :refs="block.refs"
  />
</template>
```

### 8.2 Tool Call 卡片(從 AgentWindow.vue 內聯版本抽出)

```vue
<!-- src/features/agent/components/ToolCallCard.vue -->
<script setup lang="ts">
import {computed} from 'vue'
import type {OpenAIToolCall} from '../types'

interface ToolResult {
  ok: boolean
  preview: string  // 短摘要(<400 字)
  raw?: string     // 完整內容(展開時顯示)
}

const props = defineProps<{
  toolCall: OpenAIToolCall
  result?: ToolResult
}>()

const isScreenshot = computed(
  () => props.toolCall.function.name === 'screenshot' &&
        props.result?.preview?.startsWith('data:image'),
)

const status = computed(() => {
  if (!props.result) return 'running'
  return props.result.ok ? 'ok' : 'fail'
})
</script>

<template>
  <div class="tool" :class="`tool--${status}`">
    <div class="tool__head">
      <span class="tool__icon">🔧</span>
      <code class="tool__name">{{ toolCall.function.name }}</code>
      <span class="tool__badge">
        {{ status === 'running' ? '執行中…' : status === 'ok' ? '完成' : '失敗' }}
      </span>
    </div>
    <details class="tool__body">
      <summary>查看參數與結果</summary>
      <div class="tool__section">參數</div>
      <pre>{{ toolCall.function.arguments }}</pre>
      <template v-if="result">
        <div class="tool__section">結果</div>
        <img v-if="isScreenshot" :src="result.preview" :alt="`${toolCall.function.name} 結果`" class="tool__shot" />
        <pre v-else>{{ result.preview }}</pre>
      </template>
    </details>
  </div>
</template>

<!-- 樣式從 AgentWindow.vue 的 .tool / .tool__head ... 搬過來,維持視覺一致 -->
```

### 8.3 Thinking / Citation 預留接口

```ts
// types.ts 擴充示意
|
{
    type: 'thinking';
    content: string;
    collapsed ? : boolean
}
|
{
    type: 'citation';
    refs: Array<{ title: string; url: string; snippet: string }>
}
```

**未來怎麼接**:

- LLM 回應若用 `<thinking>...</thinking>` 標籤包裝思考過程 → `parseBlocks(content)` 在解析階段抽出,生成 thinking block
- RAG 場景 LLM 返回 `[ref:1]` 帶註腳 → 解析時生成 citation block

**現在不實作,只在 `types.ts` 列型別 + 在 `MessageRenderer.vue` 預留 `v-else-if` 路由**。

### 8.4 解析器:從 plain string content 抽出 blocks

```ts
// src/features/agent/composables/parse-blocks.ts(新增)
import type {AgentMessage, MessageBlock, OpenAIToolCall} from '../types'

/**
 * 把 AgentMessage(平鋪 string + toolCalls 陣列)轉成 blocks。
 *
 * 規則(目前):
 *   - assistant + 無 toolCalls → 單一 text block
 *   - assistant + 有 toolCalls → text(content) + tool_call(每個 toolCall)
 *   - user → 單一 text block
 *
 * 將來擴充(無需動 LLM / DB):
 *   - 在 text content 內偵測 <thinking>...</thinking> → 拆出 thinking block
 *   - 在 text content 內偵測 ```mermaid ... ``` → 拆出 mermaid block(代碼塊不走 hljs)
 *   - 在 text content 內偵測 [^ref-N] → 結合 message.metadata.citations 拆出 citation block
 *
 * 純函式,易於單元測試。
 */
export function parseBlocks(
  msg: AgentMessage,
  toolResults: Map<string, {ok: boolean; preview: string}>,  // toolCallId → result
): MessageBlock[] {
  const blocks: MessageBlock[] = []

  if (msg.content?.trim()) {
    blocks.push({type: 'text', content: msg.content})
  }

  if (msg.role === 'assistant' && msg.toolCalls?.length) {
    for (const tc of msg.toolCalls) {
      blocks.push({
        type: 'tool_call',
        toolCall: tc,
        result: toolResults.get(tc.id),
      })
    }
  }

  return blocks
}
```

---

## 9. 目錄結構

```
src/features/agent/
├── AgentWindow.vue                 # (現有,本次重構瘦身:把訊息渲染分流給 ChatMessage)
├── store.ts
├── types.ts                        # (擴充:加 MessageBlock / ChatMessageVM / ToolResult)
├── prompts.ts
├── tools.ts
├── composables/
│   ├── useAgentChat.ts             # (現有)
│   ├── useAgentStream.ts           # (現有,本次加 rAF 節流)
│   ├── useAgentTools.ts            # (現有)
│   ├── agent-utils.ts              # (現有)
│   ├── markdown.ts                 # ← 新增:markdown-it + hljs 配置 + sanitize
│   ├── code-block-mount.ts         # ← 新增:upgrade <pre><code> 成 CodeBlock
│   └── parse-blocks.ts             # ← 新增:AgentMessage → MessageBlock[]
└── components/
    ├── ChatSidebar.vue             # ← (從 AgentWindow.vue 拆出,順便做)
    ├── ChatThread.vue              # ← (從 AgentWindow.vue 拆出)
    ├── ChatMessage.vue             # ← 新增:單則訊息容器
    ├── MessageRenderer.vue         # ← 新增:block 路由
    ├── MarkdownRenderer.vue        # ← 新增:markdown 渲染本體
    ├── CodeBlock.vue               # ← 新增:代碼塊 + 複製
    ├── ToolCallCard.vue            # ← 從 AgentWindow.vue 拆出
    ├── ChatComposer.vue            # ← 從 AgentWindow.vue 拆出
    ├── SettingsModal.vue           # ← 從 AgentWindow.vue 拆出
    └── PromptModal.vue             # ← 從 AgentWindow.vue 拆出
    /*  以下 P2 預留,先不建空檔
    ├── ThinkingBlock.vue
    ├── CitationBlock.vue
    └── MermaidBlock.vue
    */
```

**為什麼這個結構**:

- 跟 features/ 目錄規範(見 05-开发规范)對齊
- `composables/` 放純邏輯 / 純函式;`components/` 放 Vue SFC
- `MessageRenderer.vue` 是擴展核心(將來新 block type 只動這檔 + 加新 component)
- 將 `AgentWindow.vue` 從 ~700 行降到 ~150 行(只剩佈局 + 對話列表編排)

---

## 10. 性能優化方案總覽

### 10.1 渲染側

| 問題                            | 解法                                                          |
|-------------------------------|-------------------------------------------------------------|
| 每個 token 都 re-render markdown | rAF 節流(§4.1)                                                |
| 訊息很多時 thread 整體變慢             | `<ChatMessage>` 用 `v-memo="[m.id, m.content, m.streaming]"` |
| 代碼塊 streaming 中重建             | streaming 中**不** upgrade `<pre>` 成 `<CodeBlock>`(§4.3)      |
| markdown-it 每次 new            | 單例 + lazy init(§5.1)                                        |
| highlight.js 全量大              | 按需註冊語言(§6.3)                                                |

### 10.2 store 側

| 問題                            | 解法                                                                |
|-------------------------------|-------------------------------------------------------------------|
| `toolsFollowing(m)` O(n) 每幀重算 | 在 store 內維護 `toolResultsByCallId: Map<string, ToolResult>`,O(1) 查 |
| messages 陣列很長 → reactive 開銷大  | 用 `shallowRef` 包,個別訊息物件內部 mutate 不影響陣列追蹤(現有寫法已基本如此)               |

### 10.3 DOM 側

| 問題                             | 解法                                                   |
|--------------------------------|------------------------------------------------------|
| 一條訊息含很多代碼塊,upgradeCodeBlocks 慢 | 用 `IntersectionObserver` 懶升級(viewport 內才 upgrade)    |
| 長對話 thread 滾動卡                 | 後續考慮 `vue-virtual-scroller`(P2,等真的卡再上;500 條對話內目前不需要) |

### 10.4 v-memo 範例

```vue
<!-- ChatThread.vue -->
<ChatMessage
  v-for="m in messages"
  :key="m.id"
  v-memo="[m.id, m.content, m.streaming, m.toolCalls?.length ?? 0]"
  :message="m"
/>
```

**何時 v-memo 有效**:訊息列表很長,但大部分舊訊息不再變化。streaming 中那條每幀 invalidate,其它條全 skip,大幅減少
reconciliation。

---

## 11. 長文本優化

### 11.1 單則訊息過長(> 10K 字)

罕見場景(LLM 一次性返回長文檔),但若發生:

| 措施                            | 動機                                      |
|-------------------------------|-----------------------------------------|
| `CodeBlock` 限高 480px + scroll | 已在 §6.1 實作                              |
| Markdown body 限高(可選,UX 取捨)    | 不建議,對話完整性 > 渲染成本                        |
| 大型代碼塊 hljs 截斷                 | hljs `ignoreIllegals: true` 已開,不會在語法錯時掛 |

### 11.2 訊息列表過長(> 200 則)

短期內(目前單個對話不超過 100 則)不需處理。長期方案:

1. 後端分頁(目前 `listMessages(conversationId, limit=500)` 已限 500 上限)
2. 渲染端 virtual scroller(`vue-virtual-scroller`)— **等實際出現卡頓再上**,避免過早優化

---

## 12. 安全方案(必須通過的清單)

| 攻擊向量                                     | 對策                                                               | 位置                                |
|------------------------------------------|------------------------------------------------------------------|-----------------------------------|
| `<script>` 直接 XSS                        | markdown-it `html:false` + DOMPurify `FORBID_TAGS: ['script']`   | §5.1 / §5.2                       |
| `<img onerror>`                          | DOMPurify `FORBID_ATTR: ['onerror']`                             | §5.2                              |
| `javascript:` link                       | markdown-it `link_open` rule 攔截 + DOMPurify `ALLOWED_URI_REGEXP` | §5.1                              |
| `window.opener` 攻擊                       | 所有 link 強制 `rel="noopener noreferrer"`                           | §5.1                              |
| `<iframe>` 嵌入                            | DOMPurify `FORBID_TAGS: ['iframe']`                              | §5.2                              |
| CSS injection(`<style>` / `style="..."`) | `FORBID_TAGS: ['style']` + `FORBID_ATTR: ['style']`              | §5.2                              |
| `data:text/html` URI 繞過                  | markdown-it link_open 攔截 + DOMPurify URI regex                   | §5.1 / §5.2                       |
| `srcset` 繞過 img 檢查                       | `FORBID_ATTR: ['srcset']`                                        | §5.2                              |
| Prompt injection 從工具結果回流                 | 工具結果在 store 內**也走 markdown**,但截斷到 4000 字 + DOMPurify             | §5.2 + useAgentTools 的 `truncate` |

**信任邊界**:

- ✅ User 自己輸入的訊息 → 仍 sanitize(防使用者貼了 HTML 過來不小心炸自己)
- ✅ LLM 回應 → 永遠 sanitize(LLM 可能被 prompt injection 操控吐惡意 HTML)
- ✅ 工具結果(如 `read_file` 讀到含 HTML 的 .html 檔)→ 永遠 sanitize

**測試案例**(將來加 unit test):

```ts
const xssPayloads = [
  '<script>alert(1)</script>',
  '<img src=x onerror=alert(1)>',
  '[click](javascript:alert(1))',
  '<a href="data:text/html,<script>alert(1)</script>">x</a>',
  '<iframe src="https://evil.com"></iframe>',
  '<style>body{background:url(javascript:alert(1))}</style>',
]
for (const p of xssPayloads) {
  const out = renderMarkdown(p)
  expect(out).not.toContain('<script')
  expect(out).not.toContain('onerror')
  expect(out).not.toContain('javascript:')
  expect(out).not.toContain('<iframe')
  expect(out).not.toContain('<style')
}
```

---

## 13. 演進路徑

### Phase 1(本期執行)

- markdown-it + DOMPurify + highlight.js
- `MarkdownRenderer` + `CodeBlock` + `MessageRenderer` + `ChatMessage`
- 把 `AgentWindow.vue` 內聯的 tool 卡片抽到 `ToolCallCard.vue`
- `useAgentStream` 加 rAF 節流

### Phase 2(看實際需求)

- KaTeX(若使用者報告需要數學公式)
- Mermaid(若使用者報告需要流程圖)
- Thinking block(若接 Claude / GPT-4o 的 reasoning trace)

### Phase 3(遠期)

- Citation block(接 RAG / 知識庫場景)
- File 多模態(若 LLM 端支援上傳檔案)
- Structured Message Protocol(LLM 直接吐 JSON-RPC 風格訊息,前端按結構渲染)
- 訊息流的 virtual scrolling(對話 > 500 則才上)

---

## 14. 完整代碼示例(關鍵檔案)

### 14.1 `composables/markdown.ts`(完整版)

```ts
import MarkdownIt from 'markdown-it'
import DOMPurify from 'dompurify'
import hljs from 'highlight.js/lib/core'
import javascript from 'highlight.js/lib/languages/javascript'
import typescript from 'highlight.js/lib/languages/typescript'
import python from 'highlight.js/lib/languages/python'
// ... 其它語言

hljs.registerLanguage('javascript', javascript)
hljs.registerLanguage('typescript', typescript)
hljs.registerLanguage('python', python)
// ...

let _md: MarkdownIt | null = null
function getMd(): MarkdownIt {
  if (_md) return _md
  _md = new MarkdownIt({
    html: false,
    breaks: true,
    linkify: true,
    typographer: false,
    highlight(str, lang) {
      if (lang && hljs.getLanguage(lang)) {
        try {
          return hljs.highlight(str, {language: lang, ignoreIllegals: true}).value
        } catch {/* fallthrough */}
      }
      return _md!.utils.escapeHtml(str)
    },
  })

  // Link 安全處理(target / rel / 危險協議)
  const defaultLinkOpen = _md.renderer.rules.link_open
    ?? ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options))
  _md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
    const token = tokens[idx]
    const href = token.attrGet('href') ?? ''
    if (/^(javascript:|vbscript:|data:text\/html)/i.test(href)) {
      token.attrSet('href', '#')
    }
    token.attrSet('target', '_blank')
    token.attrSet('rel', 'noopener noreferrer nofollow')
    return defaultLinkOpen(tokens, idx, options, env, self)
  }

  return _md
}

const PURIFY_CONFIG: DOMPurify.Config = {
  ALLOWED_TAGS: [
    'p', 'br', 'hr', 'strong', 'em', 'u', 's', 'del', 'mark',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'ul', 'ol', 'li',
    'blockquote',
    'pre', 'code', 'span',
    'a', 'img',
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
  ],
  ALLOWED_ATTR: ['href', 'target', 'rel', 'src', 'alt', 'title', 'class', 'data-language'],
  ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
  FORBID_TAGS: ['style', 'iframe', 'object', 'embed', 'form', 'input', 'script'],
  FORBID_ATTR: ['onload', 'onerror', 'onclick', 'onmouseover', 'style', 'srcset'],
}

export function renderMarkdown(source: string): string {
  if (!source) return ''
  const raw = getMd().render(source)
  return DOMPurify.sanitize(raw, PURIFY_CONFIG)
}
```

### 14.2 修改後的 `useAgentStream.ts`(rAF 節流關鍵段)

```ts
// 只列出加 rAF 的部分,其它跟 composable 拆分後的版本一致
export async function consumeStream(
  stream: AsyncIterable<...>,
  assistantMsg: AgentMessage,
  controller: AbortController | null,
): Promise<StreamConsumeResult> {
  let contentBuf = ''
  let pendingFlush: number | null = null

  const flushNow = () => { assistantMsg.content = contentBuf }
  const scheduleFlush = () => {
    if (pendingFlush !== null) return
    pendingFlush = requestAnimationFrame(() => {
      pendingFlush = null
      flushNow()
    })
  }

  // ... 其餘維持原樣
  try {
    for await (const chunk of stream) {
      // ...
      if (delta?.content) {
        contentBuf += delta.content
        scheduleFlush()  // ← 取代原本的 assistantMsg.content = contentBuf
      }
      // ...
    }
  } finally {
    // 強制 flush 最後一段
    if (pendingFlush !== null) cancelAnimationFrame(pendingFlush)
    flushNow()
  }
  // ...
}
```

### 14.3 `ChatMessage.vue` 骨架

```vue
<script setup lang="ts">
import {computed} from 'vue'
import {useAgentStore} from '../store'
import {parseBlocks} from '../composables/parse-blocks'
import MessageRenderer from './MessageRenderer.vue'
import type {AgentMessage} from '../types'

const props = defineProps<{message: AgentMessage}>()
const store = useAgentStore()

// 從 store 索引出本訊息相關的 tool results(O(1) Map 查)
const toolResults = computed(() => {
  const map = new Map<string, {ok: boolean; preview: string}>()
  for (const m of store.messages) {
    if (m.role === 'tool' && m.toolCallId && m.toolDisplay) {
      map.set(m.toolCallId, m.toolDisplay)
    }
  }
  return map
})

const blocks = computed(() => parseBlocks(props.message, toolResults.value))
</script>

<template>
  <article class="msg" :class="`msg--${message.role}`">
    <div class="msg__avatar">{{ message.role === 'user' ? '您' : 'AI' }}</div>
    <div class="msg__body">
      <div class="msg__author">{{ message.role === 'user' ? '您' : 'AI Agent' }}</div>
      <MessageRenderer
        v-for="(block, i) in blocks"
        :key="i"
        :block="block"
        :streaming="message.streaming"
      />
    </div>
  </article>
</template>
```

---

## 15. 不推薦方案(明確避免)

| 方案                                           | 為何不推薦                                                |
|----------------------------------------------|------------------------------------------------------|
| 直接 `v-html` 模型輸出不過 sanitize                  | XSS 風險 100%                                          |
| 用 `vue-markdown` / `vue-markdown-render` 等套件 | 過度抽象,沒法精細控制 sanitize 規則;依賴多                          |
| 改寫 OpenAI SDK 的 stream 處理                    | 沒必要,SDK 的 `for await` 已足夠;rAF 加在我們 store 寫入端就行       |
| Streaming 中 incremental 重 render markdown    | 複雜度遠超收益;rAF 節流到 60Hz 已經夠快                            |
| 用 `MutationObserver` 自動升級 CodeBlock          | mount 階段一次 query 就夠,observer 浪費 CPU                  |
| 全量 import highlight.js 所有語言                  | bundle +500KB,沒必要                                    |
| 把 markdown 渲染搬到 main process(IPC 傳 HTML)     | IPC 開銷 + 安全邊界更難維護;render 在 render 進程就好               |
| 用 `<iframe sandbox>` 隔離渲染                    | XSS 已透過 sanitize 解決,iframe 帶來 height 同步、樣式繼承等問題,得不償失 |
| 訊息列表用 virtual scrolling(現階段)                 | 對話 < 200 則本來就不卡,過早優化                                 |

---

## 16. 落地工作清單(可勾選執行)

```
P1(本期執行)
[ ] § 5.1  npm install markdown-it highlight.js
[ ] § 5.1  composables/markdown.ts(markdown-it + sanitize + linkOpen rule)
[ ] § 6.3  highlight.js 按需註冊 16 種語言
[ ] § 4.1  useAgentStream 加 rAF 節流
[ ] § 5.3  components/MarkdownRenderer.vue
[ ] § 6.1  components/CodeBlock.vue
[ ] § 6.2  composables/code-block-mount.ts
[ ] § 8.4  composables/parse-blocks.ts
[ ] § 8.1  components/MessageRenderer.vue
[ ] § 14.3 components/ChatMessage.vue
[ ] § 8.2  components/ToolCallCard.vue(從 AgentWindow.vue 抽出)
[ ] § 9    AgentWindow.vue 瘦身(訊息列表分流給 ChatThread + ChatMessage)
[ ] § 12   寫 XSS 測試案例(至少 6 個 payload)
[ ] § 1    手動測:streaming 流暢度 / 代碼塊不閃 / 複製按鈕

P2(看需求啟用)
[ ] § 7    katex + markdown-it-katex
[ ] § 13   components/ThinkingBlock.vue
[ ] § 13   Mermaid

P3(等實際遇到再做)
[ ] § 11.2 virtual scrolling
[ ] § 13   citation / file / structured message
```

---

## 17. 驗收門檻

每項改完都要過:

- ✅ `npm run typecheck` 全綠
- ✅ `npm run build` 全綠
- ✅ Agent 對話功能保持(發訊息 / 工具調用 / 中止 / 切換對話 / 刪除對話)
- ✅ 6 個 XSS payload 渲染後不含危險 tag / 屬性 / 協議
- ✅ Streaming 80 token/s 場景下幀率不低於 30fps(打開 DevTools Performance 量)
- ✅ 帶 500 行代碼塊的訊息,從第一個 token 到完整顯示時間不超過 8s,複製按鈕可用

---

## 18. FAQ

**Q:為何不用 `marked` 而用 `markdown-it`?**
A:markdown-it plugin 生態最完整(KaTeX / mermaid / task-list 都有現成 plugin),擴展性最強。`marked` 更輕但客製化能力差。

**Q:為何 sanitize 不用 markdown-it 自己的 `html: false` 就夠?**
A:`html: false` 只防 markdown 解析階段的 raw HTML;但模型可能輸出能被 markdown 解析後仍含可疑屬性的內容(例如 link 帶
`javascript:`)。DOMPurify 是「最終一道防線」,並承擔白名單管理職責。

**Q:hljs 為何不全量?**
A:bundle size。全量 ~600KB(gzip 後 ~150KB),按需 ~100KB(gzip ~25KB)。我們對話場景的主流語言 16 種已覆蓋 90%+。

**Q:為何 Agent 窗口的代碼塊用深色 theme,主窗 IT 報修描述卻沒這需求?**
A:Agent 場景代碼出現頻率高,深色 theme 跟對話淺色背景對比明顯;IT 報修是使用者填寫表單,Quill 編輯器有自己的代碼塊樣式,本次不動。

**Q:Tool Call 的 `result` 流式更新怎麼辦?**
A:目前 tool 執行是同步的(`window.agentAPI.execTool` 一次返回完整結果),沒有流式中間態。將來若有 long-running tool(如 web
搜尋有進度),`ToolResult` 加 `streaming: boolean` 欄位,ToolCallCard 內顯示 spinner 即可。
