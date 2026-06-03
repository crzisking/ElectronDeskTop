<script lang="ts" setup>
/**
 * Agent 窗口頂部欄 — 顯示當前對話標題 + active provider 模型名。
 * 純展示元件,沒有事件 / 內部狀態。
 */
import type {ProviderConfig} from '../types'

defineProps<{
  title: string
  activeProvider: ProviderConfig | null
}>()
</script>

<template>
  <header class="topbar">
    <div class="topbar__title">
      <h1>{{ title }}</h1>
      <span v-if="activeProvider" class="model-pill">
        {{ activeProvider.label }} · {{ activeProvider.model || '未選 model' }}
      </span>
    </div>
  </header>
</template>

<style scoped>
.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 24px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  background: var(--bg);
}

.topbar__title {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.topbar__title h1 {
  font-size: 15px;
  font-weight: 600;
  color: var(--text);
  margin: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.model-pill {
  padding: 2px 8px;
  background: var(--bg-input);
  border-radius: 6px;
  font-size: 11px;
  color: var(--text-secondary);
  font-family: var(--font-mono);
  flex-shrink: 0;
}
</style>
