<script lang="ts" setup>
/**
 * CodeBlock — 代碼塊增強版(對應 doc 17 §6.1)。
 *
 * 由 `composables/code-block-mount.ts` 在 markdown 渲染完成後動態 mount 進去,
 * 把 markdown-it 產出的 `<pre><code class="hljs language-xxx">` 升級成本元件:
 *   - 頂部語言標籤 + 複製按鈕
 *   - 限高 480px + 內部滾動(避免單個代碼塊撐爆整條訊息)
 *   - 深色主題,跟 Agent 對話淺色主體形成對比
 *
 * 複製策略:優先 navigator.clipboard;Electron contextIsolation 下若 reject,
 * fallback 走 `window.agentAPI.execTool('clipboard_write', ...)` 走 main process 寫入。
 */
import {ref} from 'vue'

const props = defineProps<{
  /** 已被 hljs highlight 過的 HTML(<span class="hljs-xxx">) */
  highlightedHtml: string
  /** 純文字版本,給複製用 */
  rawCode: string
  /** 語言名;hljs 未識別時為 null,顯示 'text' */
  language: string | null
}>()

const copied = ref(false)
let timer: ReturnType<typeof setTimeout> | null = null

async function copy(): Promise<void> {
  const showCopied = () => {
    copied.value = true
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => (copied.value = false), 1500)
  }

  try {
    await navigator.clipboard.writeText(props.rawCode)
    showCopied()
  } catch {
    // contextIsolation / 權限 / 非 secure context → fallback 走 main process
    try {
      await window.agentAPI.execTool('clipboard_write', {text: props.rawCode})
      showCopied()
    } catch {
      // 真的不行就靜默失敗(極端情況)
    }
  }
}
</script>

<template>
  <div class="code-block">
    <div class="code-block__head">
      <span class="code-block__lang">{{ language ?? 'text' }}</span>
      <button
          :class="{copied}"
          class="code-block__copy"
          type="button"
          @click="copy"
      >
        {{ copied ? '已複製' : '複製' }}
      </button>
    </div>
    <!-- eslint-disable-next-line vue/no-v-html -- highlightedHtml 由上游 renderMarkdown 經 DOMPurify 清洗後再交 hljs token 著色,只剩 <span class="hljs-*"> -->
    <pre class="code-block__body"><code v-html="highlightedHtml"/></pre>
  </div>
</template>

<style scoped>
.code-block {
  margin: 0.6em 0;
  /* 深色塊 — 跟 Agent 對話的淺色背景形成對比;hard-code 不沿用 token */
  background: #1e1e2e;
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
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}

.code-block__copy:hover {
  background: #313244;
}

.code-block__copy.copied {
  color: #a6e3a1;
  border-color: #a6e3a1;
}

.code-block__body {
  margin: 0;
  padding: 10px 12px;
  overflow-x: auto;
  /* 長代碼塊優化:限高 + 內部 scroll,避免單塊撐爆訊息 */
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

/* hljs token 著色(Catppuccin Mocha 配色,跟暗底協調) */
.code-block__body :deep(.hljs-keyword) {
  color: #cba6f7;
}

.code-block__body :deep(.hljs-string) {
  color: #a6e3a1;
}

.code-block__body :deep(.hljs-number) {
  color: #fab387;
}

.code-block__body :deep(.hljs-comment) {
  color: #6c7086;
  font-style: italic;
}

.code-block__body :deep(.hljs-function),
.code-block__body :deep(.hljs-title) {
  color: #89b4fa;
}

.code-block__body :deep(.hljs-built_in) {
  color: #f9e2af;
}

.code-block__body :deep(.hljs-attr) {
  color: #94e2d5;
}

.code-block__body :deep(.hljs-variable),
.code-block__body :deep(.hljs-name) {
  color: #cdd6f4;
}

.code-block__body :deep(.hljs-meta),
.code-block__body :deep(.hljs-tag) {
  color: #94e2d5;
}

.code-block__body :deep(.hljs-literal),
.code-block__body :deep(.hljs-symbol) {
  color: #fab387;
}
</style>
