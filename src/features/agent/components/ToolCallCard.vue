<script lang="ts" setup>
/**
 * ToolCallCard — 工具呼叫卡片(對應 doc 17 §8.2)。
 *
 * 從 AgentWindow.vue 內聯模板抽出,行為 100% 對齊:
 *   - 頭部顯示 🔧 + 工具名 + 狀態 badge
 *   - <details> 摺疊區顯示參數 / 結果
 *   - screenshot 工具的 dataURL 結果用 <img> 渲染,其它用 <pre>
 *
 * Status 三態:
 *   - running:result 為 undefined(工具正在執行,目前是同步 IPC 所以瞬間切到 ok/fail)
 *   - ok:result.ok === true
 *   - fail:result.ok === false
 */
import {computed} from 'vue'
import type {OpenAIToolCall, ToolResult} from '../types'

const props = defineProps<{
  toolCall: OpenAIToolCall
  result?: ToolResult
}>()

const status = computed<'running' | 'ok' | 'fail'>(() => {
  if (!props.result) return 'running'
  return props.result.ok ? 'ok' : 'fail'
})

const isScreenshot = computed(
    () => props.toolCall.function.name === 'screenshot'
        && props.result?.preview?.startsWith('data:image'),
)

const statusLabel = computed(() => {
  switch (status.value) {
    case 'running':
      return '執行中…'
    case 'ok':
      return '完成'
    case 'fail':
      return '失敗'
  }
})
</script>

<template>
  <div :class="`tool--${status}`" class="tool">
    <div class="tool__head">
      <span class="tool__icon">🔧</span>
      <code class="tool__name">{{ toolCall.function.name }}</code>
      <span :class="status" class="tool__badge">{{ statusLabel }}</span>
    </div>
    <details class="tool__body">
      <summary>查看參數與結果</summary>
      <div class="tool__section">參數</div>
      <pre class="tool__args">{{ toolCall.function.arguments }}</pre>
      <template v-if="result">
        <div class="tool__section">結果</div>
        <img
            v-if="isScreenshot"
            :alt="`${toolCall.function.name} 結果`"
            :src="result.preview"
            class="tool__shot"
        />
        <pre v-else class="tool__out">{{ result.preview }}</pre>
      </template>
    </details>
  </div>
</template>

<style scoped>
.tool {
  margin-top: 10px;
  background: var(--bg-tool);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  overflow: hidden;
}

.tool__head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: var(--bg-input);
  font-size: 12.5px;
}

.tool__icon {
  font-size: 13px;
}

.tool__name {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--text);
  background: transparent;
}

.tool__badge {
  margin-left: auto;
  padding: 1px 8px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 500;
}

.tool__badge.ok {
  background: #ecfdf5;
  color: #047857;
}

.tool__badge.fail {
  background: #fef2f2;
  color: #b91c1c;
}

.tool__badge.running {
  background: var(--bg-active);
  color: var(--text-muted);
}

.tool__body summary {
  padding: 8px 12px;
  font-size: 12px;
  color: var(--text-muted);
  cursor: pointer;
  user-select: none;
  list-style: none;
}

.tool__body summary::before {
  content: '▸ ';
  display: inline-block;
  transition: transform 0.15s;
}

.tool__body[open] summary::before {
  content: '▾ ';
}

.tool__body summary:hover {
  color: var(--text-secondary);
}

.tool__section {
  padding: 6px 12px;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted);
  background: var(--bg);
  border-top: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
}

.tool__args,
.tool__out {
  margin: 0;
  padding: 10px 12px;
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--text-secondary);
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 280px;
  overflow: auto;
  background: var(--bg);
}

.tool__shot {
  display: block;
  max-width: 100%;
  background: #000;
}
</style>
