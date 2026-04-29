/**
 * 自動更新 IPC Handler（UPDATE_CHECK / UPDATE_DOWNLOAD / UPDATE_QUIT_AND_INSTALL）。
 * 用於：渲染層手動檢查、下載、重啟安裝。UpdateManager 由 registerAllHandlers 注入。
 * 結果 UI 主要靠 PUSH_UPDATE_* 推送事件更新，invoke 返回值前端目前未消費。
 */

import { ipcMain } from 'electron'
import { IpcChannels } from '../../shared/ipc-channels'
import { logger } from '../utils/logger'
import type { UpdateManager } from '../update-manager'

const TAG = 'IPC:update'

export function registerUpdateHandlers(updateMgr: UpdateManager): void {
  /** UPDATE_CHECK：UI 點「檢查更新」或定時 timer 觸發。 */
  ipcMain.handle(IpcChannels.UPDATE_CHECK, async () => {
    logger.debug('收到手動檢查更新請求', TAG)
    return updateMgr.check()
  })

  /** UPDATE_DOWNLOAD：autoDownload=false 時，用戶在「發現新版」彈窗點下載。 */
  ipcMain.handle(IpcChannels.UPDATE_DOWNLOAD, async () => {
    logger.debug('收到手動下載更新請求', TAG)
    return updateMgr.download()
  })

  /** UPDATE_QUIT_AND_INSTALL：用戶點「立即重啟」，主進程退出並啟動安裝程序。 */
  ipcMain.handle(IpcChannels.UPDATE_QUIT_AND_INSTALL, () => {
    logger.info('收到立即重啟並安裝請求', TAG)
    updateMgr.quitAndInstall()
  })
}
