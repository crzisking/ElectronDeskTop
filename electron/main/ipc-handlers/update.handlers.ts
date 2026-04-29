/**
 * 自動更新相關的 IPC Handler。
 *
 * 註冊以下三個雙向通道（invoke/handle）：
 *   - UPDATE_CHECK            手動檢查更新
 *   - UPDATE_DOWNLOAD         手動觸發下載（autoDownload=false 時用）
 *   - UPDATE_QUIT_AND_INSTALL 用戶確認後立即重啟並安裝新版
 *
 * 與其他 handler 一致使用「依賴注入」風格：UpdateManager 實例
 * 由 ipc-handlers/index.ts 的 registerAllHandlers() 傳入。
 */

import { ipcMain } from 'electron'
import { IpcChannels } from '../../shared/ipc-channels'
import { logger } from '../utils/logger'
import type { UpdateManager } from '../update-manager'

const TAG = 'IPC:update'

export function registerUpdateHandlers(updateMgr: UpdateManager): void {
  /**
   * UPDATE_CHECK：用戶在 UI 點「檢查更新」按鈕，或定時 timer 觸發。
   * 渲染側用法：
   *   const result = await window.electronAPI.update.check()
   * 結果（autoUpdater.checkForUpdates 的返回值）目前不在前端使用，
   * 而是依賴 PUSH_UPDATE_AVAILABLE / NOT_AVAILABLE 推送事件來更新 UI。
   */
  ipcMain.handle(IpcChannels.UPDATE_CHECK, async () => {
    logger.debug('收到手動檢查更新請求', TAG)
    return updateMgr.check()
  })

  /**
   * UPDATE_DOWNLOAD：autoDownload=false 模式下，用戶在「發現新版」彈窗
   * 點「下載」後呼叫。autoDownload=true 模式不需要這個。
   */
  ipcMain.handle(IpcChannels.UPDATE_DOWNLOAD, async () => {
    logger.debug('收到手動下載更新請求', TAG)
    return updateMgr.download()
  })

  /**
   * UPDATE_QUIT_AND_INSTALL：用戶在「下載完成」彈窗點「立即重啟」後呼叫。
   * 主進程會退出當前應用並啟動新版安裝程序。
   */
  ipcMain.handle(IpcChannels.UPDATE_QUIT_AND_INSTALL, () => {
    logger.info('收到立即重啟並安裝請求', TAG)
    updateMgr.quitAndInstall()
  })
}
