/**
 * 日誌 IPC Handler。
 * 用於：渲染端日誌落地（LOG_WRITE 單向）、設定彈窗打開日誌資料夾（LOG_OPEN_FOLDER 雙向）。
 */

import {ipcMain, shell} from 'electron'
import {IpcChannels} from '../../shared/ipc-channels'
import {logger, writeRendererLog} from '../utils/logger'
import {getLogsDir} from '../utils/log-file-writer'

const TAG = 'IPC:log'

/** 渲染端傳來的日誌條目結構(對齊 src/shared/utils/logger.ts forwardToMain) */
interface RendererLogEntry {
  level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'
  message: string
  module?: string
  args?: unknown[]
    /** 跨模組關聯 ID */
    traceId?: string
    /** 操作耗時(ms) */
    durationMs?: number
    /** 結構化 metadata */
    meta?: Record<string, unknown>
}

// ── 日誌節流：防止渲染進程高頻狂發日誌拖垮主進程文件 IO ──────────────
/** 每秒允許的最大日誌條數，超限的日誌直接丟棄 */
const MAX_LOGS_PER_SECOND = 100

/** 當前秒內已接收的日誌計數 */
let logCount = 0

/** 每秒重置計數的定時器 */
let logCountResetTimer: NodeJS.Timeout | null = null

export function registerLogHandlers(): void {
  // 用 on 而非 handle：日誌寫入「發了就忘」，避免渲染端多餘 await 開銷
  ipcMain.on(IpcChannels.LOG_WRITE, (_event, entry: RendererLogEntry) => {
    if (!entry || typeof entry.message !== 'string') return

    // 節流：每秒超過 MAX_LOGS_PER_SECOND 條的日誌直接丟棄
    logCount++
    if (!logCountResetTimer) {
      logCountResetTimer = setTimeout(() => {
        logCount = 0
        logCountResetTimer = null
      }, 1000)
    }
    if (logCount > MAX_LOGS_PER_SECOND) return

    writeRendererLog(
      entry.level ?? 'INFO',
      entry.message,
      entry.module,
        Array.isArray(entry.args) ? entry.args : undefined,
        {
            traceId: typeof entry.traceId === 'string' ? entry.traceId : undefined,
            durationMs: typeof entry.durationMs === 'number' ? entry.durationMs : undefined,
            meta: entry.meta && typeof entry.meta === 'object' ? entry.meta : undefined,
        },
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
