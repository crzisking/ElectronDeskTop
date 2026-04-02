/**
 * 配置文件 IPC Handler
 *
 * 處理渲染進程對 app-config.json 的讀寫請求。
 * 配置文件的讀寫操作必須在主進程中進行（涉及 Node.js 文件系統操作）。
 */

import { ipcMain } from 'electron'
import { IpcChannels } from '../../shared/ipc-channels'
import { logger } from '../utils/logger'
import type { ConfigManager } from '../config-manager'
import type { AppConfig } from '../../../src/types/config.types'

/**
 * 注冊所有配置 IPC Handler
 * @param configManager 配置管理器實例
 */
export function registerConfigHandlers(configManager: ConfigManager): void {
  // ─── 讀取完整配置 ─────────────────────────────────────────────
  ipcMain.handle(IpcChannels.CONFIG_READ, () => {
    const config = configManager.getConfig()
    logger.debug('渲染進程請求讀取配置', 'IPC:config')
    return config
  })

  // ─── 寫入部分配置 ─────────────────────────────────────────────
  ipcMain.handle(IpcChannels.CONFIG_WRITE, async (_event, partial: Partial<AppConfig>) => {
    try {
      await configManager.writeConfig(partial)
      logger.info('配置已更新', 'IPC:config')
    } catch (err) {
      logger.error('配置寫入失敗', 'IPC:config', err)
      throw err
    }
  })

  logger.info('配置 IPC Handlers 已注冊', 'IPC:config')
}
