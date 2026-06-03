<script lang="ts" setup>
/**
 * 頁面底部狀態列 — 工具入口頁共用。
 *
 * 左邊綠點 + 狀態文字,右邊版本號。
 * 狀態文字由父層傳(i18n key 各頁不同 / 也可能未來分別狀態)。
 */
import {useI18n} from 'vue-i18n'

defineProps<{
  version: string
}>()

const {t} = useI18n()
</script>

<template>
  <div class="page-footer">
    <div class="page-footer__left">
      <span class="status-dot"/>
      <span>{{ t('internal.statusOk') }}</span>
    </div>
    <div class="page-footer__right">
      © {{ new Date().getFullYear() }} ICHIA Enterprise {{ version }}
    </div>
  </div>
</template>

<style scoped>
.page-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  color: var(--app-text-muted);
  letter-spacing: 0.03em;
  padding-top: 8px;
  flex-shrink: 0;
}

.page-footer__left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: var(--app-success);
  box-shadow: 0 0 0 3px rgba(79, 125, 58, 0.15);
}
</style>
