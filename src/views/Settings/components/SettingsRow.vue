<script setup lang="ts">
/**
 * SettingsRow — 通用設定行佈局
 *
 * 統一所有設定項的視覺結構：左側標題+描述，右側操作控件。
 * 這樣不同 section 之間的對齊和留白可以保持一致，
 * 將來新增「啟動行為」等設定項時直接複用。
 *
 * Slots:
 *   default — 右側操作區（按鈕/開關/選擇器/文字標籤等）
 *
 * Props:
 *   title       — 設定項主標題（必填）
 *   description — 副標題說明（選填，灰色小字）
 *   compact     — 緊湊模式，行高更小（用於不需要描述的場景）
 */

defineProps<{
  title: string
  description?: string
  compact?: boolean
}>()
</script>

<template>
  <div class="settings-row" :class="{ 'is-compact': compact }">
    <div class="settings-row__text">
      <div class="settings-row__title">{{ title }}</div>
      <div v-if="description" class="settings-row__desc">{{ description }}</div>
    </div>
    <div class="settings-row__action">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.settings-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 0;
  border-bottom: 1px solid var(--app-border-subtle);
}

.settings-row:last-child {
  border-bottom: none;
}

.settings-row.is-compact {
  padding: 8px 0;
}

.settings-row__text {
  flex: 1;
  min-width: 0;
}

.settings-row__title {
  font-size: 14px;
  font-weight: 500;
  color: var(--app-text-primary);
  letter-spacing: -0.005em;
}

.settings-row__desc {
  font-size: 12px;
  color: var(--app-text-muted);
  margin-top: 4px;
  line-height: 1.5;
}

.settings-row__action {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}
</style>
