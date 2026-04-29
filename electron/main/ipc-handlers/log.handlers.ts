/**
 * 日誌 IPC Handler。
 * 用於：渲染端日誌落地（LOG_WRITE 單向）、設定彈窗打開日誌資料夾（LOG_OPEN_FOLDER 雙向）。
 */

import { ipcMain, shell } from 'electron'
import { IpcChannels } from '../../shared/ipc-channels'
import { writeRendererLog, logger } from '../utils/logger'
import { getLogsDir } from '../utils/log-file-writer'

const TAG = 'IPC:log'

/** 渲染端傳來的日誌條目結構 */
interface RendererLogEntry {
  level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'
  message: string
  module?: string
  args?: unknown[]
}

export function registerLogHandlers(): void {
  // 用 on 而非 handle：日誌寫入「發了就忘」，避免渲染端多餘 await 開銷
  ipcMain.on(IpcChannels.LOG_WRITE, (_event, entry: RendererLogEntry) => {
    if (!entry || typeof entry.message !== 'string') return
    writeRendererLog(
      entry.level ?? 'INFO',
      entry.message,
      entry.module,
      Array.isArray(entry.args) ? entry.args : undefined
    )
  })

  /** LOG_OPEN_FOLDER：shell.openPath 處理跨平台（explorer / Finder / xdg-open）。 */
  ipcMain.handle(IpcChannels.LOG_OPEN_FOLDER, async () => {
    const dir = getLogsDir()
    if (!dir) {
      logger.warn('日誌目錄尚未初始化', TAG)
      return { ok: false, dir: '' }
    }
    try {
      const error = await shell.openPath(dir)
      if (error) {
        logger.error(`打開日誌目錄失敗: ${error}`, TAG)
        return { ok: false, dir }
      }
      logger.info(`已打開日誌目錄: ${dir}`, TAG)
      return { ok: true, dir }
    } catch (err) {
      logger.error('shell.openPath 拋出異常', TAG, err)
      return { ok: false, dir }
    }
  })
}
