/**
 * useConfigText — 配置型文案的 i18n 讀取 helper
 *
 * 為什麼需要這個 composable：
 *  app-config.json 裡的 sidebar.label / systems.name 等字段是「配置驅動」的，
 *  運維可能隨時新增條目（例如新加一個系統）。我們不希望每加一條都被迫
 *  更新所有語言字典 — 字典是「漸進補翻」，配置是「即時生效」。
 *
 * 解決方案：
 *  - 字典裡有對應 key → 用字典的翻譯
 *  - 字典裡沒有 key   → fallback 到 JSON 原值（即繁中默認值）
 *
 * 這樣英文環境下未翻譯的新條目會顯示繁中，是合理降級而非 bug。
 *
 * 用法示例：
 *   <span>{{ ct(`config.sidebar.${item.id}`, item.label) }}</span>
 *   <h3>{{ ct(`config.systems.${sys.id}.name`, sys.name) }}</h3>
 *
 * dev 模式還會把缺失 key 收集起來輸出 warn，便於補翻。
 */

import {useI18n} from 'vue-i18n'

/** dev 模式下已警告過的 key，避免每次渲染都打日誌污染控制台 */
const warnedKeys = new Set<string>()

export function useConfigText() {
    const {t, te, locale} = useI18n()

    /**
     * 讀取配置型文案。
     * @param key 字典 key，例如 'config.systems.sys-erp.name'
     * @param fallback JSON 原值（繁中），字典缺失時使用
     */
    function ct(key: string, fallback: string): string {
        if (te(key)) return t(key)

        // 只在「非基線語言」漏 key 才警告。
        // 為什麼：zh-TW 是基線語言，config.* 故意留空（運維在 app-config.json 寫繁中即可），
        // fallback 到 JSON 原值就是設計意圖。在 zh-TW 下警告會誤報整片配置缺失。
        // 切到 en/簡中等其它語言時，如果還是 fallback 到繁中，那才是真正的漏翻。
        if (import.meta.env.DEV
            && locale.value !== 'zh-TW'
            && !warnedKeys.has(`${locale.value}::${key}`)) {
            warnedKeys.add(`${locale.value}::${key}`)
            // 用 console.warn 而非 logger，避免循環依賴（logger 自己也會用 i18n）
            console.warn(`[i18n][${locale.value}] missing config translation: ${key} → fallback "${fallback}"`)
        }

        return fallback
    }

    return {ct}
}
