# Agent 訊息渲染系統演進路徑

> **本文承接**:[17-Agent訊息渲染系統設計.md](./17-Agent訊息渲染系統設計.md) 已完成的 P1(markdown + 代碼高亮 + rAF +
> 安全雙保險)。
>
> **目的**:把原 doc 17 §13 「Phase 2 / Phase 3」展開成可執行的演進路線 — 每個演進項都包含:
>   1. **觸發條件**(什麼信號讓我們動工,不是「想到了就上」)
>   2. **技術選型決策**(具體用什麼套件 / 自寫,有比較)
>   3. **檔案改動清單**(對齊現有目錄結構)
>   4. **Bundle / 性能影響**(明確的數字預估)
>   5. **風險與回退**(失敗的代價)
>   6. **工時估算**
>
> **不改的契約**:`MessageBlock` discriminated union + `MessageRenderer` 路由,所有演進項都必須能融入這套抽象,不另起爐灶。

---

## 0. TL;DR — 演進路線一覽

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ P1 已完成(doc 17 §16)                                                       │
│   markdown-it + DOMPurify + highlight.js + rAF + ChatMessage + MessageRenderer│
│   ✅ 訊息已是「3 層渲染體系」,後續所有演進都在這個骨架上長出                  │
└─────────────────────────────────────────────────────────────────────────────┘
                                  │
        ┌─────────────────────────┼─────────────────────────────────┐
        ▼                         ▼                                 ▼
   ━━━ Phase 2 ━━━           ━━━ Phase 3A ━━━              ━━━ Phase 3B 以上 ━━━
   (能力擴充)                (性能 / 規模)                 (協議 / 多模態)

   2A Thinking block         3A Virtual scrolling          3B Citation block
      +0 KB, ~0.5d              +30 KB, ~1.5d                +5 KB, ~2-3d + 後端
      ① 觸發:接 DeepSeek-R1     ① 觸發:單對話 > 200 訊息       ① 觸發:接 RAG 後端
         /Claude 3.7 thinking     /滾動 fps < 30                /知識庫場景

   2B KaTeX                                                3C File 多模態
      +250 KB, ~1d                                            +0 KB(沿用 base64),~3-5d
      ① 觸發:LLM 數學 / 公式                                   ① 觸發:接 vision LLM
         查詢出現

   2C Mermaid                                              3D Structured Message Protocol
      +800 KB(動態 import 才不污染),~2-3d                    架構級重寫,~1-2 週
      ① 觸發:確認業務需求(否則直接砍)                          ① 觸發:同時有 ≥ 3 個
                                                                  block type 並存,
                                                                  且後端能吐 JSON-RPC 風格
```

**核心建議**:

- **Phase 2 內部優先序**:Thinking block(最簡 + 已有 LLM 觸發點)→ KaTeX(視需求)→ Mermaid(**默認砍掉**,除非有明確業務
  case)
- **Phase 3 內部優先序**:Virtual scrolling(純性能,不卡業務)→ Citation block(若接 RAG)→ File 多模態(若接 vision)→
  Structured Message Protocol(**最後做,可能根本不做**)
- **演進原則**:每個 Phase 之間獨立可發佈,不阻塞;不要為了「將來可能用」提前接

---

## 1. 演進決策樹

開始任何 Phase 2/3 工作前,先問三個問題:

```
┌─────────────────────────────────────────────────────┐
│ 1. 觸發條件是否成立?                                  │
│   - 沒成立 → 不做(避免過早優化)                       │
│   - 已成立 → 進入 Q2                                  │
└─────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────┐
│ 2. 跟現有 MessageBlock / MessageRenderer 抽象兼容?    │
│   - 否(需要動 store / IPC / DB)→ 先升級抽象,再做      │
│   - 是 → 進入 Q3                                      │
└─────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────┐
│ 3. Bundle 增量在預算內?                               │
│   - 否(> 500 KB)→ 動態 import + 用戶 opt-in           │
│   - 是 → 直接靜態 import                              │
└─────────────────────────────────────────────────────┘
```

**Bundle 預算**:Agent 窗口當前 ~710 KB(P1 後),目標**長期不超過 1.5 MB**。

- 靜態 import:所有 P2/P3 累積必須在預算內
- 動態 import:不計入主 bundle,首次使用時下載(用戶感知度低)

---

## 2. Phase 2A — Thinking Block

### 2.1 觸發條件

**任一成立即可動工**:

- 接 DeepSeek-R1 / Claude 3.7 Sonnet (extended thinking) / GPT-o1 等帶 reasoning trace 的模型
- 使用者反饋「想看 AI 怎麼想的」
- DeepSeek-V3 chain-of-thought 內容開始出現(現在已經偶爾會回 `<think>...</think>`)

**判斷依據**:在 `useAgentStream` 內 console.log 一週 raw deltas,看 chunk.delta 是否有 `reasoning_content` /
`thinking_content` 之類欄位,或 content 內出現 `<think>` / `<thinking>` 標籤。

### 2.2 技術選型

**兩種 thinking 形態**,要分別處理:

| 形態                       | 來源                                   | 處理方式                                                                   |
|--------------------------|--------------------------------------|------------------------------------------------------------------------|
| **流外 reasoning_content** | DeepSeek-R1、Claude extended thinking | 在 `useAgentStream` 內加 `reasoningBuf`,跟 `contentBuf` 平行累積;結束時作為獨立 block |
| **流內 `<thinking>` 標籤**   | DeepSeek-V3、開源模型 prompt 提示           | 在 `parseBlocks` 內用 regex 切分 text → thinking block + text block         |

**不引入新套件**。純 string parsing。

### 2.3 檔案改動

```
新增:
  src/features/agent/components/ThinkingBlock.vue       # 摺疊 UI,默認 collapsed

修改:
  electron/shared/types/agent.types.ts                  # AgentMessage 加 `reasoningContent?: string`
  electron/main/db/features/agent/{schema,service}.ts   # agent_messages 表加 reasoningContent 欄位
  electron/main/db/migrations/0006_*.sql                # ALTER TABLE add column
  src/features/agent/types.ts                           # MessageBlock thinking 啟用(已預留)
  src/features/agent/composables/useAgentStream.ts      # 處理 delta.reasoning_content
  src/features/agent/composables/parse-blocks.ts        # 偵測 <thinking> 標籤 + reasoningContent
  src/features/agent/components/MessageRenderer.vue     # v-else-if block.type === 'thinking'
```

### 2.4 ThinkingBlock.vue 設計

```vue

<script setup lang="ts">
  /**
   * ThinkingBlock — 顯示 LLM 推理過程。
   *
   * UX 取捨:
   *   - 預設 collapsed(80% 用戶不關心推理細節,只看結論)
   *   - 流式中顯示「思考中…」+ 縮排動畫
   *   - 流結束顯示「已思考 N 秒」(用 timestamp 算)
   *   - 內容走 MarkdownRenderer,跟一般文字一樣排版
   */
  defineProps<{
    content: string
    streaming?: boolean
    /** 思考耗時(ms),流結束才計算 */
    duration?: number
  }>()
</script>

<template>
  <details class="thinking">
    <summary>
      <span v-if="streaming">💭 思考中…</span>
      <span v-else>💭 已思考 {{ (duration ?? 0) / 1000 }} 秒</span>
    </summary>
    <MarkdownRenderer :source="content" :streaming="streaming"/>
  </details>
</template>
```

### 2.5 風險與緩解

| 風險                                          | 緩解                                                                         |
|---------------------------------------------|----------------------------------------------------------------------------|
| Reasoning 內容可能含 prompt injection(模型「想」要做壞事) | 走同樣 sanitize 管線                                                            |
| Reasoning 跨進程儲存量大(DeepSeek-R1 可吐萬字)         | 截斷:單則訊息 reasoning 最多存 16KB,超過警告                                            |
| DB schema 變更影響既有使用者                         | ALTER TABLE add column 是 idempotent,既有 row reasoningContent = NULL,UI 自動跳過 |

### 2.6 工時 / Bundle

- **工時**:0.5 天(含 DB migration + UI + 解析邏輯)
- **Bundle**:+0 KB(純 string 處理)
- **風險**:低

---

## 3. Phase 2B — KaTeX

### 3.1 觸發條件

**全部成立才動工**(嚴格,因為 bundle 不便宜):

- 使用者場景出現數學公式(物理 / 統計 / ML 文檔 QA 等)
- 數學相關 query 占比 > 5%(從對話歷史 sample 評估)
- 已驗證 markdown plain 渲染無法滿足(例如使用者抱怨 `\frac{a}{b}` 沒顯示)

**Anti-trigger**(不該動工):

- 「未來可能需要」← NO,等真的需要再上
- 「ChatGPT 有所以我也要」← NO,我們不是 ChatGPT

### 3.2 技術選型

**選 katex,不選 MathJax**:

| 維度               | KaTeX                          | MathJax 3 |
|------------------|--------------------------------|-----------|
| Bundle(min+gzip) | ~250 KB                        | ~600 KB   |
| 渲染速度             | 同步,< 1ms / formula             | 異步,~10ms  |
| 覆蓋語法             | LaTeX 子集(夠用)                   | 完整 LaTeX  |
| 整合 markdown-it   | `@vscode/markdown-it-katex` 現成 | 較複雜       |

**結論**:KaTeX。

**選 `@vscode/markdown-it-katex`,不選舊的 `markdown-it-katex`**:後者已停止維護;前者由 VS Code 團隊維護,跟 markdown-it 14
兼容。

### 3.3 檔案改動

```bash
npm install katex @vscode/markdown-it-katex
```

```
修改:
  src/features/agent/composables/markdown.ts            # md.use(katex 插件)
  src/entries/agent/main.ts                             # import 'katex/dist/katex.min.css'
  src/features/agent/components/MarkdownRenderer.vue    # CSS 對 .katex 容器補樣式
```

**`markdown.ts` 改動**:

```ts
import katex from '@vscode/markdown-it-katex'
// ...
_md.use(katex.default, {
    throwOnError: false,
    errorColor: 'var(--danger)',
    // 允許 LaTeX 命令清單:防 macro injection 攻擊面
    trust: false,
})
```

**`markdown.ts` 的 DOMPurify ALLOWED_TAGS 補充**:

```ts
// KaTeX 輸出包含大量 MathML 標籤
ALLOWED_TAGS: [
    // ... 既有
    'math', 'mrow', 'mo', 'mi', 'mn', 'ms', 'mtext',
    'msup', 'msub', 'msubsup', 'munderover',
    'mfrac', 'mroot', 'msqrt',
    'mtable', 'mtr', 'mtd',
    'annotation', 'semantics', 'mspace', 'mpadded',
],
```

### 3.4 流式渲染策略

KaTeX 渲染**同步**,單個公式 < 1ms。對 rAF 節流不增加額外負擔。

但有個坑:streaming 過程中公式可能不完整。例如 `$\frac{a}` 還沒到 `{b}$` 時,KaTeX 會渲染失敗。對策:

- `throwOnError: false` 失敗時顯示原文,不炸
- 流結束後自然重渲染為完整公式

不需要為 KaTeX 加特殊邏輯。

### 3.5 風險與緩解

| 風險                                          | 緩解                                                         |
|---------------------------------------------|------------------------------------------------------------|
| `$` 在自然語言中被誤判為公式起始(如 "It costs $5 and $10") | markdown-it-katex 預設要求 `$...$` 內為合法 LaTeX 才解析,普通 `$5` 不會誤觸 |
| LaTeX macro injection(`\def`, `\edef` 等)    | `trust: false`(預設)禁止危險命令                                   |
| KaTeX CSS 衝突                                | KaTeX 的 CSS 都 scoped 在 `.katex` 容器,不污染外部                   |
| Bundle +250 KB                              | 接受。對 Electron app 不敏感(本地檔案載入)                              |

### 3.6 工時 / Bundle

- **工時**:1 天(含安全 review + DOMPurify 白名單擴充 + CSS 微調)
- **Bundle**:+250 KB
- **風險**:低

---

## 4. Phase 2C — Mermaid

### 4.1 觸發條件 — **默認不上**

我們對 Mermaid 的態度是**默認砍掉**,除非以下任一條件強觸發:

- 使用者明確要求「LLM 給我畫個流程圖」
- 業務場景是技術文檔生成,流程圖是核心交付物
- 連續 2 週以上使用者反饋「我想看流程圖」

**為何默認砍**:

1. **+800 KB bundle**(動態 import 才不算),最大依賴
2. **異步渲染**,跟 streaming 體驗衝突
3. **替代方案存在**:LLM 完全可以直接吐 SVG / ASCII 流程圖,或在外部工具(draw.io 等)畫好截圖貼進來
4. **安全表面大**:Mermaid 自帶 SVG 渲染,XSS surface 比 markdown-it 大得多

### 4.2 真的要上的話 — 技術選型

```bash
npm install mermaid --save
```

**核心策略:動態 import**

```ts
// src/features/agent/components/MermaidBlock.vue
async function renderMermaid(code: string, container: HTMLElement) {
    // 動態 import,Mermaid 不計入主 bundle
    const mermaid = await import('mermaid')
    mermaid.default.initialize({
        startOnLoad: false,
        theme: 'default',
        securityLevel: 'strict',  // ★ 必須,否則 SVG 可注入 script
    })
    const {svg} = await mermaid.default.render(`mermaid-${Date.now()}`, code)
    container.innerHTML = svg  // svg 經過 strict mode 已沙箱化
}
```

**parseBlocks 內偵測**:

```ts
// 偵測 ```mermaid ... ``` 代碼塊,不走 hljs 路徑
const mermaidMatch = content.match(/```mermaid\n([\s\S]*?)\n```/g)
// 拆分 text + mermaid blocks
```

### 4.3 風險 — 顯著高於前兩項

| 風險                                       | 緩解                                                    |
|------------------------------------------|-------------------------------------------------------|
| Mermaid SVG XSS(它本身渲染 SVG,可塞 `<script>`) | `securityLevel: 'strict'` + DOMPurify 對 SVG 元素白名單嚴格控管 |
| 動態 import 失敗(網路 / chunk 損壞)              | try/catch fallback 顯示原始 mermaid 代碼塊                   |
| Mermaid 內部 fontawesome 圖標載入需要外部資源        | strict mode 禁止;不靠這                                    |
| 大型流程圖渲染卡頓(節點 > 200)                      | 限制 code 長度 8KB,超過拒絕渲染                                 |

### 4.4 工時 / Bundle

- **工時**:2-3 天(含安全 review + 動態 import 整合 + 測試異常路徑)
- **Bundle 主**:+5 KB(動態 import 桩代碼)
- **Bundle 動態 chunk**:+800 KB(首次用到才下載)
- **風險**:中(主要在 XSS 表面)

### 4.5 強烈建議

如果真的觸發了 Mermaid 需求,先嘗試「**讓 LLM 直接吐 SVG**」的方案:

- 在 system prompt 加「需要流程圖時直接輸出有效 SVG」
- 我們的 markdown sanitize 對 SVG 白名單(可控制)
- 零新依賴,完全可控

只有當 SVG 路線失敗(LLM 吐的 SVG 渲染不出 / 太醜)才考慮 Mermaid。

---

## 5. Phase 3A — Virtual Scrolling

### 5.1 觸發條件

- 單一對話訊息數 > 200 後出現明顯卡頓(滾動 fps < 30,可在 Chrome DevTools Performance 量)
- 或回到歷史長對話(`listMessages(conversationId, 500)` 拉滿)時首次渲染 > 1.5s

**注意**:有了 P1 的 `v-memo`(對齊 doc 17 §10.4)後,200 訊息內基本不卡。先觀察。

### 5.2 技術選型

**選 `vue-virtual-scroller`,不選 `@tanstack/vue-virtual` 或自寫**:

| 維度       | vue-virtual-scroller  | tanstack-vue-virtual | 自寫  |
|----------|-----------------------|----------------------|-----|
| Bundle   | ~30 KB                | ~25 KB               | 0   |
| 動態高度支援   | ✅ 內建(DynamicScroller) | 需手動配 measure         | 自己做 |
| 維護狀態     | 活躍                    | 較新但活躍                | —   |
| Vue 3 兼容 | next 版本               | ✅                    | —   |
| 學習曲線     | 低(API 像 v-for)        | 中                    | 高   |

**選 vue-virtual-scroller**:訊息列表高度天然動態(streaming 中變化),DynamicScroller 內建測量機制省事。

### 5.3 關鍵實作要點

**Streaming 訊息特殊處理**:Virtual scrolling 假設項目高度穩定。但 streaming 中 assistantMsg 高度持續變化,不適合放在虛擬列表內。

**對策**:**最後一條 streaming 訊息獨立渲染,不進虛擬列表**:

```vue

<DynamicScroller :items="historicalMessages" ...>
  <template #default="{ item }">
    <ChatMessage :message="item" v-memo="[item.id, item.content]"/>
  </template>
</DynamicScroller>

<!-- streaming 中的訊息獨立渲染,不在虛擬列表內 -->
<ChatMessage v-if="streamingMsg" :message="streamingMsg"/>
```

**`historicalMessages` 定義**:`store.visibleMessages` 排除最後一條 `streaming === true` 的訊息。

### 5.4 風險

| 風險                       | 緩解                                |
|--------------------------|-----------------------------------|
| 對話切換時 scroll position 丟失 | 切換對話自動 scroll 到底,符合 chat UX       |
| 訊息高度測量誤差導致空白閃爍           | DynamicScroller 重測量機制處理;接受首次滾動的微閃 |
| `v-memo` 跟虛擬列表內 key 衝突   | 確保 `:key="m.id"` 穩定               |

### 5.5 工時 / Bundle

- **工時**:1.5 天
- **Bundle**:+30 KB
- **風險**:低

---

## 6. Phase 3B — Citation Block

### 6.1 觸發條件

- 接 RAG 後端(知識庫 / 文檔檢索)
- LLM 響應需要附帶**可點擊跳轉**的引用源
- 不是「會偶爾出現的 markdown link」,而是**結構化的引用列表 + 行內標註**

### 6.2 後端契約設計(這部分要先談)

Citation 的核心是**後端要先吐結構化引用資訊**,前端只是渲染。約定:

**LLM API 響應擴充**(目前 OpenAI 兼容,需要 prompt 引導或自訂後端中間層):

```json
{
  "choices": [
    {
      "message": {
        "role": "assistant",
        "content": "TypeScript 是 [^1] 微軟開發的,基於 JavaScript [^2]。",
        "metadata": {
          "citations": [
            {
              "id": "1",
              "title": "TypeScript Handbook",
              "url": "https://...",
              "snippet": "TypeScript is..."
            },
            {
              "id": "2",
              "title": "JavaScript MDN",
              "url": "https://...",
              "snippet": "JS is..."
            }
          ]
        }
      }
    }
  ]
}
```

**前端解析路徑**:

1. `consumeStream` 取出 metadata.citations(若有)
2. 落到 `AgentMessage.citations`(types 擴充)
3. `parseBlocks` 偵測 `[^N]` → 替換為 `<sup class="cite-ref" data-id="N">[N]</sup>`
4. **訊息末尾**生成 `{type: 'citation', refs: [...]}` block
5. `CitationBlock` 顯示引用列表,行內 `<sup>` click 時 highlight 對應條目

### 6.3 檔案改動

```
新增:
  src/features/agent/components/CitationBlock.vue       # 引用列表
  src/features/agent/composables/cite-handler.ts        # 行內 <sup> 點擊 → 滾到對應引用

修改:
  electron/shared/types/agent.types.ts                  # AgentMessage 加 citations?: CitationRef[]
  electron/main/db/features/agent/{schema,service}.ts   # agent_messages 加 citations 欄位(JSON 字串)
  electron/main/db/migrations/0007_*.sql
  src/features/agent/composables/parse-blocks.ts        # [^N] 替換 + citation block 生成
  src/features/agent/composables/markdown.ts            # ALLOWED_TAGS 加 'sup' + data-id 屬性
  src/features/agent/composables/useAgentStream.ts      # 從 chunk 取 metadata.citations
  src/features/agent/components/MarkdownRenderer.vue    # mount 後綁定 .cite-ref 的 click handler
  src/features/agent/components/MessageRenderer.vue     # v-else-if 'citation'
```

### 6.4 風險

| 風險                                | 緩解                                        |
|-----------------------------------|-------------------------------------------|
| 後端契約沒談攏,前端架構過早假設                  | 先跟後端確認 citation 結構;沒談攏前不動工                |
| 引用 URL 是外鏈,內網 Electron app 可能無法訪問 | 引用結果 url click 走 shell.openExternal,跟主窗一致 |
| 大量 `[^N]` 標記在流式中被誤解析              | 流末才做替換(streaming 中保持原文)                   |

### 6.5 工時 / Bundle

- **工時**:2-3 天前端 + 後端契約 1-2 天(若後端從零搭)
- **Bundle**:+5 KB
- **風險**:中(主要在跨端契約)

---

## 7. Phase 3C — File 多模態

### 7.1 觸發條件

- 接 vision LLM(GPT-4 Vision / Claude 3.5 Sonnet / Qwen-VL 等)
- 使用者場景需要傳檔案(截圖標註、PDF 摘要、Excel 解讀)
- 已有後端能處理檔案 upload + base64 編碼(或 OpenAI 兼容的 `image_url`)

### 7.2 技術選型

**OpenAI vision API 格式對齊**(因為我們的 SDK 已經是 OpenAI 兼容):

```json
{
  "role": "user",
  "content": [
    {
      "type": "text",
      "text": "看一下這張圖"
    },
    {
      "type": "image_url",
      "image_url": {
        "url": "data:image/png;base64,..."
      }
    }
  ]
}
```

**現有 `AgentMessage.content: string` 需要重大改動**:支援 multi-part content。

### 7.3 型別演進策略 — **這是 P3 中最大的契約變動**

```ts
// electron/shared/types/agent.types.ts
type MessagePart =
    | { type: 'text'; text: string }
    | { type: 'image_url'; image_url: { url: string; detail?: 'low' | 'high' } }

export interface AgentMessage {
    // ... 既有
    content: string | MessagePart[]  // ← 兼容單 string 與 multi-part
}
```

**向後兼容**:

- 既有對話訊息全是 string,程式碼 `typeof content === 'string'` 走原路徑
- 新訊息可以是 MessagePart[]
- `agent_messages` 表的 content 欄位儲存 JSON 字串(如果是 MessagePart[]),讀取時 JSON.parse

### 7.4 UI 元件

```
新增:
  src/features/agent/components/ImageAttachment.vue     # 訊息內嵌圖片(縮圖 + 點擊放大)
  src/features/agent/components/FileAttachment.vue      # PDF / Excel / 其它檔案(下載連結 + 圖示)
  src/features/agent/components/Composer.vue 改造        # 輸入框支援拖放 / 貼上圖片

修改:
  src/features/agent/composables/useAgentChat.ts        # buildApiMessages 處理 multi-part
  src/features/agent/composables/parse-blocks.ts        # 從 MessagePart[] 生成 file block
  src/features/agent/types.ts                           # MessageBlock 加 file 啟用
```

### 7.5 檔案儲存策略

| 來源               | 處理                                              |
|------------------|-------------------------------------------------|
| 使用者拖放 / 貼上的圖片    | 讀成 base64 dataURL,直接放 `image_url.url`(< 5MB)    |
| 大檔案(PDF / Excel) | 走後端 upload(類似 IT 報修 `/api/repair/upload`),取 URL |
| 截圖工具回傳的 dataURL  | 已經是 base64,直接用                                  |

### 7.6 風險

| 風險                                   | 緩解                                                      |
|--------------------------------------|---------------------------------------------------------|
| base64 image 撐爆 IPC payload          | 圖片 > 2MB 強制 resize,> 5MB 拒絕                             |
| 對話歷史含大量 image 把 SQLite 拖慢            | 圖片 base64 不存 DB,改存 userData/agent-attachments/ 並只記 path |
| Vision LLM API key 跟 chat 不同 baseUrl | 在設定面板加 vision endpoint;或同 endpoint 多模型                  |

### 7.7 工時 / Bundle

- **工時**:3-5 天(含 multi-part content 重構 + 三個 UI 元件 + 拖放邏輯)
- **Bundle**:+0 KB(沿用既有依賴)
- **風險**:中(content 型別變動會在編譯期暴露所有受影響的點,但測試覆蓋要全)

---

## 8. Phase 3D — Structured Message Protocol(慎重考慮)

### 8.1 觸發條件 — **可能根本不做**

- 已有 ≥ 3 個 block type 並存(thinking + citation + file)
- 後端能吐 JSON-RPC 風格的結構化響應(LLM 直接輸出 JSON-RPC,不是字串)
- 文字 + markdown 處理變得「總是要切分」,parseBlocks 邏輯複雜化

**Anti-trigger**:

- 「為了優雅」← NO
- 「將來可能用得到」← NO
- 「LLM 不一定能穩定吐 JSON」← 別逼,讓它說人話

### 8.2 它到底是什麼

把當前的「LLM 吐 markdown 字串,前端解析 blocks」翻轉成「LLM 直接吐 blocks JSON,前端零解析渲染」。

```
傳統(目前):
  LLM:"分析結果如下:[^1]\n```python\ncode\n```\n總結..."
  前端:parseBlocks() 解析成 [text, code, citation, text]

JSON-RPC 風格:
  LLM:
  {
    "blocks": [
      {"type": "text", "content": "分析結果如下:[^1]"},
      {"type": "code", "language": "python", "code": "code"},
      {"type": "text", "content": "總結..."}
    ]
  }
  前端:零解析,直接餵 MessageRenderer
```

### 8.3 為何強烈建議延後 / 不做

1. **LLM 穩定吐 JSON 困難**:即使 `response_format: 'json_object'`,在大量 token + 多 block 下出錯率非零。一個 trailing
   comma 整條訊息崩
2. **失去 markdown 靈活性**:LLM 在 JSON content 內又得寫 markdown,雙層轉義
3. **streaming 困難**:JSON 沒完整解析前不能渲染;tokens 拆 JSON 也容易壞
4. **前端解析其實不貴**:markdown-it 解析速度很快,parseBlocks 是 O(n) 字串掃描
5. **OpenAI / DeepSeek 沒給這套 API**:要自己包後端中間層,業務上得不償失

**多數情況下,Phase 3D 應該被一個更好的 parseBlocks 取代**,不是引入新協議。

### 8.4 真的要做的話 — 大致方向

```
新增:
  src/features/agent/composables/structured-stream.ts  # streaming JSON parser(增量)

修改:
  src/features/agent/composables/useAgentStream.ts     # 支援雙模式:純文字 / 結構化
  src/features/agent/composables/parse-blocks.ts       # 結構化模式直接 pass-through
```

需要一個**增量 JSON parser**(如 `@streamparser/json`),streaming 場景下能解析部分 JSON。+30 KB bundle。

### 8.5 工時 / Bundle

- **工時**:1-2 週(架構級重寫 + 雙模式支援 + 大量測試)
- **Bundle**:+30 KB(增量 JSON parser)
- **風險**:高(可能投入後發現 LLM 穩定性不足,要回退)

---

## 9. 跨階段依賴矩陣

| 演進項                    | 依賴的前置                                   | 阻塞後續 |
|------------------------|-----------------------------------------|------|
| 2A Thinking            | P1 完成                                   | —    |
| 2B KaTeX               | P1 完成                                   | —    |
| 2C Mermaid             | P1 完成                                   | —    |
| 3A Virtual scrolling   | P1 完成                                   | —    |
| 3B Citation            | P1 完成 + 後端 RAG API                      | —    |
| 3C File 多模態            | P1 完成 + content 型別擴充                    | 3D   |
| 3D Structured Protocol | 3C 已上(content 已是 array)+ ≥ 3 block type | —    |

**獨立可上的**:2A / 2B / 2C / 3A / 3B(只要後端配合)— 任何順序都行。
**有先後依賴的**:3D 必須在 3C 後(因為 content 型別演進是它的前提)。

---

## 10. 性能監控錨點

每個 Phase 上線前,建立基線並驗收:

| 指標                               | 量測方式                 | P1 基線    | P2 後預期              | P3 後預期                    |
|----------------------------------|----------------------|----------|---------------------|---------------------------|
| Agent 主 bundle 大小                | `npm run build` 輸出   | ~710 KB  | ~960 KB(+250 KaTeX) | ~1.2 MB                   |
| 首屏渲染時間(開窗到可互動)                   | Chrome DevTools Perf | < 500ms  | < 600ms             | < 800ms                   |
| Streaming 幀率(80 token/s 場景)      | Perf monitor         | > 50 fps | > 50 fps            | > 45 fps                  |
| 500 訊息對話載入時間                     | 手動計時                 | ~1.5s    | ~1.5s               | < 800ms(virtual scroll 後) |
| markdown render 單次(無代碼塊)         | console.time         | < 3ms    | < 3ms               | < 3ms                     |
| markdown render 單次(含代碼塊 + KaTeX) | —                    | —        | < 8ms               | < 8ms                     |

**回退指標**:任一 Phase 後上述指標惡化超過 20%,**該 Phase 整體回退**。

---

## 11. 安全清單(隨 Phase 累積)

每個新 block / 新依賴都要過這份清單:

```
[ ] markdown-it 配置仍保持 html: false
[ ] DOMPurify ALLOWED_TAGS / ATTR 白名單已對應新元素更新
[ ] 新依賴是否引入 eval / Function / innerHTML 直寫
[ ] 動態 import 的 chunk 來源可信(走 npm registry,不從 CDN)
[ ] LLM 輸出在新 block 內走的處理路徑仍經 sanitize
[ ] 跨 IPC 邊界的 payload 仍是純 plain object(toRaw 處理 proxy)
[ ] 新增的 click handler 不被 LLM 輸出污染(透過 data-* 屬性 + 程式碼端 query 綁定,不用 onclick="...")
```

針對 Phase 2/3 特定威脅:

| Phase             | 威脅                                   | 對策                                       |
|-------------------|--------------------------------------|------------------------------------------|
| 2A Thinking       | reasoning 內容含 prompt injection       | 同樣 sanitize 管線                           |
| 2B KaTeX          | LaTeX macro injection(`\def`)        | `trust: false`                           |
| 2C Mermaid        | SVG `<script>` 注入                    | `securityLevel: 'strict'` + SVG 白名單      |
| 3A Virtual scroll | —                                    | 純性能,無安全變化                                |
| 3B Citation       | 引用 URL 可能是 `javascript:`             | 跟 link 同樣的 URL 白名單檢查                     |
| 3C File 多模態       | base64 內含 polyglot 檔案(image 內藏 HTML) | MIME 嚴格檢查 + 不用 image dataURL 當 link href |
| 3D Structured     | LLM 吐惡意 JSON 結構(例:type: '__proto__') | JSON.parse 後用 zod schema 校驗              |

---

## 12. 不做的事(明確劃線)

避免演進路徑膨脹失控,以下事項本路線圖**外**:

- ❌ 自己重寫 markdown 解析器(markdown-it 已足夠成熟)
- ❌ 引入 React / Svelte 元件互操作(我們是純 Vue)
- ❌ 把 markdown 渲染搬到 main process(渲染就該在渲染進程,參考 doc 17 §15)
- ❌ 接入 langchain.js / llamaindex(我們是輕量 desktop agent,不是 RAG framework)
- ❌ 自做 token-level diff 增量渲染(rAF + computed memo 已夠用,參考 doc 17 §4.2)
- ❌ WebGL / Canvas 渲染訊息(DOM 對對話 UI 已最優)
- ❌ Web Worker 跑 markdown render(rAF + computed 已將主執行緒峰值控制在 16ms 內)

---

## 13. 決策日誌(留給未來自己看)

每個 Phase 啟動 / 結束時,在這節追加決策記錄:

```
[YYYY-MM-DD] Phase 2A 啟動
  觸發:DeepSeek-R1 接入,reasoning_content 開始出現
  決定:不改 DB schema,reasoning 只存在 in-memory(歷史對話的 reasoning 丟棄)
  反思:--(後續補)

[YYYY-MM-DD] Phase 2B 評估,延後
  觸發評估:6 個月內無數學公式 query → 不上 KaTeX
  決定:擱置 6 個月後再評估
  ...
```

---

## 14. 工時總覽

| Phase               | 工時        | Bundle 增量 | 累積 Bundle |
|---------------------|-----------|-----------|-----------|
| P1(已完成)             | 2 天       | +350 KB   | ~710 KB   |
| 2A Thinking         | 0.5d      | 0         | ~710 KB   |
| 2B KaTeX            | 1d        | +250 KB   | ~960 KB   |
| 2C Mermaid(默認不做)    | 2-3d      | +5 KB(動態) | ~965 KB   |
| 3A Virtual scroll   | 1.5d      | +30 KB    | ~995 KB   |
| 3B Citation         | 2-3d + 後端 | +5 KB     | ~1.0 MB   |
| 3C File 多模態         | 3-5d      | 0         | ~1.0 MB   |
| 3D Structured(可能不做) | 1-2 週     | +30 KB    | ~1.05 MB  |

**累積最壞情況**:1.05 MB(全做 + Mermaid 動態),仍在 1.5 MB 預算內。

**現實預測**:6 個月內可能上的有 2A + 3A + 3C,總 ~6 個工作日,bundle 增量 ~30 KB。
