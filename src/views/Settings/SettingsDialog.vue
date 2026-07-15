<script setup lang="ts">
/**
 * SettingsDialog — 應用設置彈窗
 *
 * ── 對外接口 ─────────────────────────────────────────────────────────
 * 父組件用 v-model 控制顯示：
 *   <SettingsDialog v-model="settingsVisible" />
 *
 * ── 結構 ─────────────────────────────────────────────────────────────
 * 純容器組件，把每個分區（section）作為子組件嵌入：
 *   ├── 軟體更新（UpdateSection）
 *   └── 語言（LanguageSection，預留）
 *
 * 將來新增「啟動行為」等設定，只需：
 *   1. 在 sections/ 下新增 *Section.vue 檔
 *   2. 在本組件的 template 中加入 <SettingsCategory> 和對應的 <XxxSection>
 *
 * ── 為什麼用 el-dialog 而不是 el-drawer ─────────────────────────────
 * 設定項數量不多（< 10 項），用居中彈窗更聚焦；
 * 若將來分類超過 5 個，可改成左側 tab + 右側內容的「設定中心」佈局
 * （仍然用 el-dialog 包裹，只是內部換成 left-rail + content 結構）。
 */

import {useI18n} from 'vue-i18n'
import UpdateSection from './sections/UpdateSection.vue'
import LanguageSection from './sections/LanguageSection.vue'
import LogSection from './sections/LogSection.vue'
import LlmSection from './sections/LlmSection.vue'
import {Setting} from '@element-plus/icons-vue'

const {t} = useI18n()

defineProps<{
  /** 彈窗是否顯示（v-model:modelValue） */
  modelValue: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

function close() {
  emit('update:modelValue', false)
}
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    width="600px"
    :close-on-click-modal="false"
    :show-close="true"
    align-center
    class="settings-dialog"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <!-- 自定義頭部：圖標 + 標題（el-dialog 的 #header slot） -->
    <template #header>
      <div class="settings-dialog__header">
        <div class="header-icon">
          <el-icon :size="18"><Setting /></el-icon>
        </div>
        <div class="header-text">
          <div class="header-title">{{ t('settings.title') }}</div>
          <div class="header-subtitle">{{ t('settings.subtitle') }}</div>
        </div>
      </div>
    </template>

    <div class="settings-dialog__body">
      <!-- AI 服務商分區(LlmSection)— provider 列表 + active 切換 + 測試連線 -->
      <section class="settings-category">
        <div class="settings-category__title">{{ t('settings.sections.llm') }}</div>
        <LlmSection/>
      </section>

      <!-- 軟體更新分區 -->
      <section class="settings-category">
        <div class="settings-category__title">{{ t('settings.sections.update') }}</div>
        <UpdateSection />
      </section>

      <!-- 語言分區 -->
      <section class="settings-category">
        <div class="settings-category__title">{{ t('settings.sections.language') }}</div>
        <LanguageSection />
      </section>

      <!-- 日誌與診斷分區 -->
      <section class="settings-category">
        <div class="settings-category__title">{{ t('settings.sections.log') }}</div>
        <LogSection />
      </section>
    </div>

    <template #footer>
      <el-button @click="close">{{ t('common.close') }}</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
/* ── 彈窗整體微調 ──────────────────────────────────────────── */
:deep(.settings-dialog .el-dialog__header) {
  padding: 18px 24px 14px;
}

:deep(.settings-dialog .el-dialog__body) {
  padding: 0 24px 8px;
}

/* ── Header：圖標 + 標題 + 副標題 ───────────────────────────── */
.settings-dialog__header {
  display: flex;
  align-items: center;
  gap: 12px;
}

.header-icon {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  background: var(--app-bg-elevated);
  border: 1px solid var(--app-border-subtle);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--app-text-primary);
  flex-shrink: 0;
}

.header-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.header-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--app-text-primary);
  letter-spacing: -0.01em;
}

.header-subtitle {
  font-size: 12px;
  color: var(--app-text-muted);
  letter-spacing: 0.02em;
}

/* ── 內容區：分區列表 ───────────────────────────────────────── */
.settings-dialog__body {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding-top: 8px;
  padding-bottom: 8px;
  max-height: 60vh;
  overflow-y: auto;
}

.settings-category {
  display: flex;
  flex-direction: column;
}

.settings-category__title {
  font-size: 11px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--app-text-muted);
  font-weight: 500;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--app-border-subtle);
  margin-bottom: 4px;
}
</style>
