<script lang="ts" setup>
/**
 * MarkdownRenderer — Markdown 渲染本體(對應 doc 17 §5.3)。
 *
 * 流程:
 *   1. `renderMarkdown(source)` 拿到 sanitized HTML(markdown-it + DOMPurify)
 *   2. `v-html` 注入
 *   3. mount / source 變化 + 非 streaming → upgradeCodeBlocks 把 <pre><code> 換成 CodeBlock
 *
 * Streaming 守衛:`props.streaming=true` 時不升級 CodeBlock,避免每幀 mount/unmount 閃爍。
 * 流結束(streaming 變 false)後執行升級一次。
 */
import {computed, onBeforeUnmount, ref, watch} from 'vue'
import {renderMarkdown} from '../composables/markdown'
import {upgradeCodeBlocks} from '../composables/code-block-mount'

const props = defineProps<{
  source: string
  /** streaming 中:跳過 CodeBlock 升級(等流完再升級) */
  streaming?: boolean
}>()

const containerRef = ref<HTMLElement | null>(null)
const cleanups = ref<Array<() => void>>([])

// computed:Vue 自動 memo,source 不變就不重 render
const renderedHtml = computed(() => renderMarkdown(props.source))

function cleanup() {
  cleanups.value.forEach((fn) => fn())
  cleanups.value = []
}

// watch:source 或 streaming 變化時觸發升級
//  - streaming=true 期間:只更新 v-html,不 upgrade(讓 streaming 順)
//  - streaming=false 後:upgrade 一次,把 <pre><code> 換成 CodeBlock
//  - flush:'post' 確保在 DOM 更新後執行(v-html 注入完成)
watch(
    () => [renderedHtml.value, props.streaming] as const,
    ([, streaming]) => {
      if (!containerRef.value || streaming) {
        cleanup()
        return
      }
      cleanup()
      cleanups.value = upgradeCodeBlocks(containerRef.value)
    },
    {flush: 'post', immediate: true},
)

onBeforeUnmount(cleanup)
</script>

<template>
  <!-- eslint-disable-next-line vue/no-v-html -- renderMarkdown 內部已經 DOMPurify.sanitize,見 composables/markdown.ts -->
  <div ref="containerRef" class="md-body" v-html="renderedHtml"/>
</template>

<style scoped>
/* 對齊 Agent 窗口的本地 token(來自 §1.11,已 alias 到主窗 --app-*) */
.md-body :deep(p) {
  margin: 0.5em 0;
}

.md-body :deep(p:first-child) {
  margin-top: 0;
}

.md-body :deep(p:last-child) {
  margin-bottom: 0;
}

.md-body :deep(h1),
.md-body :deep(h2),
.md-body :deep(h3),
.md-body :deep(h4),
.md-body :deep(h5),
.md-body :deep(h6) {
  font-weight: 600;
  margin: 1em 0 0.5em;
  line-height: 1.3;
}

.md-body :deep(h1) {
  font-size: 1.4em;
}

.md-body :deep(h2) {
  font-size: 1.25em;
}

.md-body :deep(h3) {
  font-size: 1.1em;
}

.md-body :deep(h4),
.md-body :deep(h5),
.md-body :deep(h6) {
  font-size: 1em;
}

.md-body :deep(ul),
.md-body :deep(ol) {
  padding-left: 1.4em;
  margin: 0.5em 0;
}

.md-body :deep(li) {
  margin: 0.2em 0;
}

.md-body :deep(blockquote) {
  margin: 0.5em 0;
  padding: 6px 12px;
  border-left: 3px solid var(--border-strong);
  background: var(--bg-tool);
  color: var(--text-secondary);
}

/* inline code(非代碼塊):用淺底區分 */
.md-body :deep(code) {
  font-family: var(--font-mono);
  font-size: 0.92em;
  padding: 1px 5px;
  background: var(--bg-input);
  border-radius: 4px;
}

/* pre 內部會被 CodeBlock 接管;這裡是 streaming 中或升級失敗時的 fallback 樣式 */
.md-body :deep(pre) {
  margin: 0.6em 0;
  background: var(--bg-tool);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 10px 12px;
  overflow-x: auto;
}

.md-body :deep(pre code) {
  background: transparent;
  padding: 0;
  font-size: 13px;
  color: var(--text);
}

/* link 強制走 accent 色 */
.md-body :deep(a) {
  color: var(--accent);
  text-decoration: none;
  border-bottom: 1px solid transparent;
  transition: border-color 0.15s;
}

.md-body :deep(a:hover) {
  border-bottom-color: var(--accent);
}

/* table:緊湊 + 邊框 */
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

.md-body :deep(hr) {
  border: none;
  border-top: 1px solid var(--border);
  margin: 1em 0;
}

.md-body :deep(img) {
  max-width: 100%;
  height: auto;
  border-radius: var(--radius-sm);
}
</style>
