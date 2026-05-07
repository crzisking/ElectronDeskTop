/**
 * useLanguage — 統一的語言切換邏輯
 *
 * 把「切 i18n + 寫 config + 失敗回滾」抽成一個 composable，
 * 給 Settings 的 LanguageSection 和側邊欄的快捷切換按鈕共用。
 *
 * 設計取捨：
 *  - 「先切 UI 再寫盤」：寫盤是異步 IPC，等回來再切會有 100~300ms 卡頓感；
 *    寫盤失敗也不影響本次 session 顯示效果，下次啟動回退到舊配置即可
 *  - switching 標誌防止用戶連點觸發競態
 *  - 失敗時自動回滾 i18n locale，並把錯誤透給呼叫方便組件決定要不要彈 toast
 */

import {computed, ref} from 'vue'
import {useI18n} from 'vue-i18n'
import {useConfigStore} from '@/stores/config.store'
import {setLocale, SUPPORTED_LOCALES, isSupportedLocale, type SupportedLocale} from '@/locales'
import {logger} from '@/utils/logger'

/**
 * 各語言的母語顯示名（不走 i18n —— 切到任何語言都能看懂選項）
 * 與 SUPPORTED_LOCALES 對齊；新增語言時這裡加一行。
 */
export const LANGUAGE_LABELS: Record<SupportedLocale, string> = {
  'zh-TW': '繁體中文（台灣）',
  'en':    'English'
}

/** 可選語言列表（給 dropdown / select 渲染用） */
export const LANGUAGE_OPTIONS = SUPPORTED_LOCALES.map((value) => ({
  value,
  label: LANGUAGE_LABELS[value]
}))

export function useLanguage() {
  const {locale} = useI18n()
  const configStore = useConfigStore()

  /** 切換中標誌，防止競態 */
  const switching = ref(false)

  /** 當前語言（響應式跟隨 i18n.locale） */
  const currentLocale = computed<SupportedLocale>(() => {
    const v = locale.value
    return isSupportedLocale(v) ? v : 'zh-TW'
  })

  /** 當前語言的母語顯示名 */
  const currentLabel = computed(() => LANGUAGE_LABELS[currentLocale.value])

  /**
   * 切換語言並持久化。
   * @param target 目標語言代碼
   * @returns true 成功 / false 失敗（已自動回滾）
   */
  async function switchLanguage(target: SupportedLocale): Promise<boolean> {
    if (switching.value) return false
    if (!isSupportedLocale(target)) return false
    if (target === currentLocale.value) return true

    const previous = currentLocale.value
    switching.value = true

    // 1. 立即切 UI（i18n + Element Plus + html lang）
    setLocale(target)

    // 2. 持久化
    try {
      await configStore.writeConfig({
        app: {...configStore.appConfig!.app, language: target}
      })
      return true
    } catch (err) {
      // 寫盤失敗：回滾
      setLocale(previous)
      logger.error('語言寫入配置失敗，已回滾', 'useLanguage', err)
      return false
    } finally {
      switching.value = false
    }
  }

  return {
    currentLocale,
    currentLabel,
    switching,
    switchLanguage
  }
}
