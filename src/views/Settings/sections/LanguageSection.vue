<script setup lang="ts">
/**
 * LanguageSection — 設定彈窗的「語言」分區（預留實作）
 *
 * 目前階段：UI 已就位，但實際切換功能尚未接入。
 *  - 顯示當前語言（從 configStore.appConfig.app.language 讀取）
 *  - 提供下拉選擇器，但選項暫時鎖死、選擇後不生效（會提示「即將支援」）
 *
 * 後續實作 i18n 時，要做的事：
 *  1. 引入 vue-i18n，建立 src/locales/{zh-TW,en,zh-CN}.json
 *  2. 在 main.ts 中根據 app.language 載入對應語言包
 *  3. 把本組件的 @change 改成「呼叫 configStore.writeConfig({ app: { language } })」
 *     並且通知 i18n 切換（i18n.global.locale = newLang）
 *  4. 移除這裡的 disabled 屬性
 *
 * 把這層佔位放出來的目的：
 *  - 設計上預留入口，產品 / 用戶能看到「未來會支援多語言」的承諾
 *  - 開發上把 UI 部分先寫完，將來只接邏輯，不動 UI
 */

import { computed, ref } from 'vue'
import { useConfigStore } from '@/stores/config.store'
import { ElMessage } from 'element-plus'
import SettingsRow from '../components/SettingsRow.vue'

const configStore = useConfigStore()

/** 支援的語言選項（後續可以從 i18n 配置讀取） */
const LANGUAGE_OPTIONS = [
  { value: 'zh-TW', label: '繁體中文（台灣）' },
  { value: 'zh-CN', label: '简体中文' },
  { value: 'en',    label: 'English' }
]

/** 當前語言（雙向綁定到本地 ref，避免直接改 store） */
const currentLanguage = ref<string>(configStore.appConfig?.app?.language ?? 'zh-TW')

/** 當前語言對應的顯示名稱 */
const currentLanguageLabel = computed(
  () => LANGUAGE_OPTIONS.find((o) => o.value === currentLanguage.value)?.label ?? '繁體中文'
)

/**
 * 用戶切換語言的處理（暫未實作，提示開發中）
 * 等接入 vue-i18n 後改為實際的語言切換邏輯。
 */
function handleLanguageChange(value: string) {
  ElMessage.info(`多語言切換功能開發中（已選擇：${value}）`)
  // 還原回原值，避免 UI 狀態不一致
  currentLanguage.value = configStore.appConfig?.app?.language ?? 'zh-TW'
}
</script>

<template>
  <div class="language-section">
    <SettingsRow
      title="界面語言"
      description="切換應用的顯示語言（多語言功能即將支援）"
    >
      <el-select
        v-model="currentLanguage"
        size="small"
        style="width: 180px"
        disabled
        @change="handleLanguageChange"
      >
        <el-option
          v-for="opt in LANGUAGE_OPTIONS"
          :key="opt.value"
          :value="opt.value"
          :label="opt.label"
        />
      </el-select>
    </SettingsRow>

    <SettingsRow title="當前語言" description="目前應用顯示使用的語言" compact>
      <span class="meta-text">{{ currentLanguageLabel }}</span>
    </SettingsRow>
  </div>
</template>

<style scoped>
.language-section {
  display: flex;
  flex-direction: column;
}

.meta-text {
  font-size: 13px;
  color: var(--app-text-secondary);
}
</style>
