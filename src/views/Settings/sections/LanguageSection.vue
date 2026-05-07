<script setup lang="ts">
/**
 * LanguageSection — 設定彈窗的「語言」分區
 *
 * 接入流程（用戶切換時做三件事）：
 *  1. 立即呼叫 setLocale(lang) 切 i18n + Element Plus locale + html lang
 *     —— 即時生效，不用等寫盤回來
 *  2. 寫入 configStore.writeConfig({ app: { language } }) 持久化
 *     —— 應用下次啟動會直接用這個語言
 *  3. 失敗回滾：如果寫盤拋錯，把下拉框切回原值並提示
 *
 * 為什麼順序是「先切 UI 再寫盤」：
 *  - 寫盤是異步 IPC，等回來再切 UI 會有 100~300ms 卡頓感
 *  - 寫盤失敗也不影響本次 session 顯示效果，下次啟動會回退到舊配置
 */

import {computed, ref} from 'vue'
import {ElMessage} from 'element-plus'
import {useI18n} from 'vue-i18n'
import {useConfigStore} from '@/stores/config.store'
import {setLocale, SUPPORTED_LOCALES, isSupportedLocale, type SupportedLocale} from '@/locales'
import SettingsRow from '../components/SettingsRow.vue'

const configStore = useConfigStore()
const {t} = useI18n()

/**
 * 支援的語言選項。
 * label 直接寫對應語言的母語名稱（不走 i18n），這樣切換到任何語言都能看懂選項。
 * 對齊 SUPPORTED_LOCALES，新增語言時這裡加一行即可。
 */
const LANGUAGE_OPTIONS: Array<{ value: SupportedLocale; label: string }> = [
  { value: 'zh-TW', label: '繁體中文（台灣）' },
  { value: 'en',    label: 'English' }
]

/** 當前語言（雙向綁定到下拉框） */
const currentLanguage = ref<SupportedLocale>(
  isSupportedLocale(configStore.appConfig?.app?.language)
    ? configStore.appConfig!.app.language as SupportedLocale
    : 'zh-TW'
)

/** 當前語言對應的顯示名稱（用於「當前語言」那一行） */
const currentLanguageLabel = computed(
  () => LANGUAGE_OPTIONS.find((o) => o.value === currentLanguage.value)?.label ?? currentLanguage.value
)

/**
 * 用戶切換語言。
 * 為了避免併發切換造成的競態（連續快速點擊），加一個切換中標誌。
 */
const switching = ref(false)

async function handleChange(value: SupportedLocale) {
  if (switching.value) return
  if (!isSupportedLocale(value)) return

  const previous = currentLanguage.value
  switching.value = true

  // 1. 立即切 UI（vue-i18n + Element Plus + html lang）
  setLocale(value)

  // 2. 持久化到 config 文件
  try {
    await configStore.writeConfig({app: {...configStore.appConfig!.app, language: value}})
    // 原文：語言已切換
    ElMessage.success(t('settings.language.switched'))
  } catch (err) {
    // 寫盤失敗：回滾 UI
    setLocale(previous)
    currentLanguage.value = previous
    // 原文：語言切換失敗
    ElMessage.error(t('settings.language.switchFailed'))
  } finally {
    switching.value = false
  }
}
</script>

<template>
  <div class="language-section">
    <!-- 原文 title：界面語言；description：切換應用的顯示語言 -->
    <SettingsRow
      :title="t('settings.language.label')"
      :description="t('settings.language.description')"
    >
      <el-select
        v-model="currentLanguage"
        size="small"
        style="width: 180px"
        :disabled="switching"
        @change="handleChange"
      >
        <el-option
          v-for="opt in LANGUAGE_OPTIONS"
          :key="opt.value"
          :value="opt.value"
          :label="opt.label"
        />
      </el-select>
    </SettingsRow>

    <!-- 原文 title：當前語言；description：目前應用顯示使用的語言 -->
    <SettingsRow :title="t('settings.language.current')" :description="t('settings.language.currentDesc')" compact>
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
