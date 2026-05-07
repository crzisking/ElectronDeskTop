/**
 * 國際化（i18n）初始化入口
 *
 * 職責：
 *  1. 創建 vue-i18n 實例（Composition API 模式 / legacy: false）
 *  2. 提供 setLocale(lang) 統一切換 vue-i18n + Element Plus locale + html lang
 *  3. 暴露 SupportedLocale 類型供 Settings 語言切換器與 config 使用
 *
 * 為什麼選 Composition API 模式：
 *  - 與 Vue 3 <script setup> 一致；可在 setup() 外用 i18n.global.t(...)
 *  - 更好的 TypeScript 類型推導（字典 key 可被類型化）
 *
 * 默認語言策略：
 *  - 由 main.ts 在 configStore 加載完成前就創建 i18n（用 'zh-TW' 兜底）
 *  - configStore 加載完成後 App.vue 再呼叫 setLocale(config.app.language) 矯正
 *  - 這樣即使配置加載失敗，應用也能渲染（不會因為 t() 找不到字典而崩潰）
 */

import {createI18n, type MessageCompiler, type MessageContext} from 'vue-i18n'
import zhTw from './zh-TW.json'
import en from './en.json'
import elZhTw from 'element-plus/es/locale/lang/zh-tw'
import elEn from 'element-plus/es/locale/lang/en'

// ── 自定義 messageCompiler（CSP 安全，不用 new Function） ─────────
// 為什麼自己寫：
//  1. vue-i18n 默認 compiler 用 new Function 構造消息函數，會被 Electron CSP
//     的 'script-src' 策略攔截（沒開 'unsafe-eval'）
//  2. 官方推薦的 @intlify/unplugin-vue-i18n 在 dev 模式下對 JSON 的預編譯
//     行為不一致（JIT/AOT 在不同版本表現不同），調試成本太高
//  3. 我們實際只用「{name} 字符串插值」這一種模板能力，30 行手寫就能覆蓋，
//     比引入插件穩定且可控
//
// 支援的模板語法：
//   普通文字：'登錄成功'
//   命名插值：'下載中 {percent}'      → t(key, { percent: '50%' })
//   多個插值：'發現新版本 {version}'   → t(key, { version: '1.2.3' })
//
// 不支援（我們沒用到）：plural、choice、list 索引插值
const NAMED_PATTERN = /\{(\w+)}/g

const cspSafeCompiler: MessageCompiler = (message) => {
  // 已經是函數（理論上不會發生，但防禦性處理）
  if (typeof message !== 'string') {
    return () => String(message)
  }
  // 純文本快路徑：沒有 {} 插值，避開正則開銷
  if (!message.includes('{')) {
    return () => message
  }
  // 帶插值：返回一個用 ctx.named() 取值的函數
  return (ctx: MessageContext) => {
    return message.replace(NAMED_PATTERN, (_, key: string) => {
      const v = ctx.named(key)
      return v == null ? '' : String(v)
    })
  }
}

// ── 類型 ────────────────────────────────────────────────────
/** 支持的語言代碼列表（單一真實源；新增語言時這裡先擴） */
export const SUPPORTED_LOCALES = ['zh-TW', 'en'] as const
export type SupportedLocale = typeof SUPPORTED_LOCALES[number]

/** Element Plus 內建多語包映射（與 SUPPORTED_LOCALES 對齊） */
const ELEMENT_PLUS_LOCALES = {
  'zh-TW': elZhTw,
  'en': elEn
} as const

// ── i18n 實例 ───────────────────────────────────────────────
export const i18n = createI18n({
  legacy: false,            // Composition API 模式（required for Vue 3 <script setup>）
  locale: 'zh-TW',          // 默認繁中，配置加載後由 setLocale 矯正
  fallbackLocale: 'zh-TW',  // 找不到 key 時 fallback 到繁中
  messages: {
    'zh-TW': zhTw,
    en
  },
  // 提供自定義 compiler：vue-i18n 遇到字符串消息時用我們的編譯函數，
  // 而不是內建的 new Function 路徑（被 CSP 攔截）
  messageCompiler: cspSafeCompiler,
  // 沉默缺失 key 的警告（生產環境）；dev 保留以便發現漏翻
  missingWarn: import.meta.env.DEV,
  fallbackWarn: import.meta.env.DEV
})

/**
 * 切換應用語言。
 * 同時切換：
 *  - vue-i18n locale（驅動所有 t() 調用）
 *  - Element Plus locale（驅動 ElDatePicker / ElPagination 等內建組件文案）
 *  - <html lang="..."> 屬性（輔助瀏覽器/輔具識別）
 *
 * 注意：Element Plus locale 切換需要透過 ConfigProvider 包裹，
 * 我們在 App.vue 用 <el-config-provider :locale="elementLocale"> 響應式綁定。
 *
 * @param lang 目標語言代碼，必須在 SUPPORTED_LOCALES 中
 */
export function setLocale(lang: SupportedLocale): void {
  i18n.global.locale.value = lang
  document.documentElement.setAttribute('lang', lang)
}

/** 獲取對應 Element Plus locale 對象（供 ConfigProvider 用） */
export function getElementLocale(lang: SupportedLocale) {
  return ELEMENT_PLUS_LOCALES[lang]
}

/** 是否為合法的語言代碼（運行時校驗，配置文件值可能不規範） */
export function isSupportedLocale(value: unknown): value is SupportedLocale {
  return typeof value === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(value)
}
