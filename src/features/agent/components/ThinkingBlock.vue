<script lang="ts" setup>
/**
 * ThinkingBlock — 顯示 LLM 的「思考過程」(對應 doc 18 §2.4)。
 *
 * 觸發來源:
 *   - LLM 在 content 內輸出 <think>...</think> 區段(DeepSeek-V3 / 開源模型透過 prompt 引導)
 *   - 由 `parse-blocks.ts` 切分後產生 `{type: 'thinking', content: ...}` block
 *
 * UX 設計:
 *   - **默認 collapsed**,80% 用戶只關心結論
 *   - <details> 原生摺疊,無 JS 開銷,鍵盤可達
 *   - 內容仍走 `MarkdownRenderer` 處理(模型在思考時也可能用 markdown)
 *   - streaming 中顯示「思考中…」,流結束顯示「已思考」
 *   - 沒接 R1 路徑,所以**沒有 duration 計時**(reasoning_content 路徑才有 timestamp 可算耗時)
 */
import MarkdownRenderer from './MarkdownRenderer.vue'

defineProps<{
  content: string
  /** streaming 中傳 true,讓內部 MarkdownRenderer 跳過 CodeBlock 升級 */
  streaming?: boolean
}>()
</script>

<template>
  <details class="thinking">
    <summary class="thinking__summary">
      <span class="thinking__icon">💭</span>
      <span v-if="streaming" class="thinking__label">思考中…</span>
      <span v-else class="thinking__label">已思考</span>
      <span class="thinking__hint">點擊展開</span>
    </summary>
    <div class="thinking__body">
      <MarkdownRenderer :source="content" :streaming="streaming"/>
    </div>
  </details>
</template>

<style scoped>
.thinking {
  margin-top: 6px;
  margin-bottom: 6px;
  background: var(--bg-tool);
  border: 1px dashed var(--border);
  border-radius: var(--radius-sm);
  overflow: hidden;
}

.thinking__summary {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  font-size: 12px;
  color: var(--text-muted);
  cursor: pointer;
  user-select: none;
  list-style: none;
}

/* 隱藏原生 <details> 三角形,自己畫 */
.thinking__summary::-webkit-details-marker {
  display: none;
}

.thinking__summary::before {
  content: '▸';
  display: inline-block;
  width: 10px;
  color: var(--text-faint);
  transition: transform 0.15s;
}

.thinking[open] .thinking__summary::before {
  transform: rotate(90deg);
}

.thinking__icon {
  font-size: 13px;
  line-height: 1;
}

.thinking__label {
  font-weight: 500;
}

.thinking__hint {
  margin-left: auto;
  font-size: 11px;
  color: var(--text-faint);
  letter-spacing: 0.02em;
}

.thinking[open] .thinking__hint {
  /* 展開時隱藏「點擊展開」提示,避免冗餘 */
  display: none;
}

.thinking__body {
  padding: 8px 14px 10px;
  border-top: 1px dashed var(--border);
  /* 思考內容用更弱的字色,跟主回答區分 */
  color: var(--text-secondary);
  font-size: 13.5px;
  line-height: 1.55;
  max-height: 480px;
  overflow-y: auto;
}
</style>
