/**
 * 安全的外部鏈接打開工具。
 *
 * 為什麼需要這層封裝：
 *  shell.openExternal() 直接接收任意字串會把 javascript: / file:// 等危險協議
 *  傳給作業系統，輕則洩漏本地檔案、重則執行任意代碼。本應用所有 URL 來源
 *  （app-config.json、子窗口 window.open、IPC handler 的浮球菜單）都應該
 *  經過本檔案的 safeOpenExternal() 統一校驗。
 *
 * 放行規則：
 *  - http://、https://  ← 業務系統的常見場景
 *  - mailto:           ← IT 報修工單可能要寫郵件
 *  其餘協議一律拒絕並落日誌。
 */

import {shell} from 'electron'
import {logger} from './logger'

const TAG = 'SafeShell'

/** 允許的協議前綴（小寫比對） */
const ALLOWED_PROTOCOLS = ['http:', 'https:', 'mailto:'] as const

/**
 * 校驗並打開外部鏈接。
 * @param url 待打開的 URL 字串
 * @returns true 表示已交給系統打開；false 表示被白名單攔截
 */
export function safeOpenExternal(url: string | undefined | null): boolean {
    if (!url || typeof url !== 'string') {
        logger.warn('safeOpenExternal 收到空 URL', TAG)
        return false
    }

    // 用 URL 構造函數解析協議；不能解析的（例如 'javascript:alert(1)' 後綴）也會拋
    let parsed: URL
    try {
        parsed = new URL(url)
    } catch {
        logger.warn(`URL 無法解析，拒絕打開: ${url}`, TAG)
        return false
    }

    if (!ALLOWED_PROTOCOLS.includes(parsed.protocol as typeof ALLOWED_PROTOCOLS[number])) {
        logger.warn(`協議 ${parsed.protocol} 不在白名單內，拒絕打開: ${url}`, TAG)
        return false
    }

    // 校驗通過，交給作業系統處理
    shell.openExternal(url).catch((err) => {
        logger.error(`shell.openExternal 失敗: ${url}`, TAG, err)
    })
    return true
}
