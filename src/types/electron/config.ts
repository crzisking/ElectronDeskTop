/**
 * electronAPI.config 子介面。
 * 配置讀寫(實作在 electron/main/ipc-handlers/config.handlers.ts)。
 */

import type {AppConfig} from '../config'

export interface ConfigAPI {
    /**
     * 讀取完整應用配置。
     * @returns 解析後的 AppConfig 物件
     */
    read: () => Promise<AppConfig>

    /**
     * 寫入部分配置(深合併)。
     * @param config 要更新的配置欄位(Partial)
     */
    write: (config: Partial<AppConfig>) => Promise<void>
}
