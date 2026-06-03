/**
 * 配置文件 IPC Handler（讀/寫 app-config.json）。
 * 用於：渲染進程讀寫配置；文件 IO 必須在主進程進行。
 */

import {ipcMain} from 'electron'
import {IpcChannels} from '../../shared/ipc-channels'
import {logger} from '../utils/logger'
import type {ConfigManager} from '../config-manager'
import type {AppConfig} from '../../../src/types/config'

/**
 * AppConfig 頂層合法字段白名單。
 * 用於：CONFIG_WRITE 時校驗渲染進程傳入的 partial 是否只包含合法字段，
 * 防止惡意或有 bug 的渲染進程寫入非法數據。
 */
// version 由主進程從 app.getVersion() 注入，不允許渲染端寫入
const ALLOWED_CONFIG_KEYS = new Set<keyof AppConfig>([
    'app', 'sidebar', 'floatingBall',
    'unifiedPlatform', 'internalFunctions', 'update'
])

/**
 * 註冊所有配置 IPC Handler。
 * @param configManager 配置管理器實例
 */
export function registerConfigHandlers(configManager: ConfigManager): void {
  ipcMain.handle(IpcChannels.CONFIG_READ, () => {
    const config = configManager.getConfig()
    logger.debug('渲染進程請求讀取配置', 'IPC:config')
    return config
  })

  ipcMain.handle(IpcChannels.CONFIG_WRITE, async (_event, partial: Partial<AppConfig>) => {
    try {
        // 校驗頂層 key：只允許寫入 AppConfig 的合法字段
        const keys = Object.keys(partial) as (keyof AppConfig)[]
        for (const key of keys) {
            if (!ALLOWED_CONFIG_KEYS.has(key)) {
                const errMsg = `不允許寫入的配置字段: ${String(key)}`
                logger.warn(errMsg, 'IPC:config')
                throw new Error(errMsg)
            }
        }

      await configManager.writeConfig(partial)
      logger.info('配置已更新', 'IPC:config')
    } catch (err) {
      logger.error('配置寫入失敗', 'IPC:config', err)
      throw err
    }
  })

  logger.info('配置 IPC Handlers 已注冊', 'IPC:config')
}
