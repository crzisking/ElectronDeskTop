/**
 * 日誌文件寫入器（按日輪轉 + 自動清理過期檔）。
 * 用於：utils/logger.ts 的文件輸出端；獨立成模塊以集中文件相關邏輯。
 * 路徑：prod=<userData>/logs/，dev=專案根 logs/。
 */

import { app } from 'electron'
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync, appendFile } from 'fs'
import { join } from 'path'

/** 日誌來源，決定寫到 main-* 還是 renderer-* */
export type LogSource = 'main' | 'renderer'

/** 啟動時清理超過此天數的舊日誌 */
const RETENTION_DAYS = 14

/** init 必須在 app.whenReady 後呼叫一次 */
let initialized = false

/** 日誌目錄完整路徑（init 後賦值） */
let logsDir = ''

/**
 * 初始化日誌目錄並清理過期文件。
 * 用於：electron/main/index.ts 的 whenReady 一開始就呼叫。
 * 必須在任何寫入動作之前呼叫一次，重複呼叫無副作用。
 */
export function initLogFileWriter(): void {
  if (initialized) return

  if (app.isPackaged) {
    logsDir = join(app.getPath('userData'), 'logs')
  } else {
    // 開發環境放專案根目錄便於查看
    logsDir = join(app.getAppPath(), 'logs')
  }

  if (!existsSync(logsDir)) {
    mkdirSync(logsDir, { recursive: true })
  }

  cleanupOldLogs()

  initialized = true

  // 不寫啟動 banner —— 我們只記錯誤，沒錯誤就不該有檔案
}

/**
 * 寫一行日誌到對應來源的文件，init 之前呼叫會被靜默丟棄。
 * @param source 'main' 主進程 / 'renderer' 渲染進程
 * @param line   完整一行（已含時間戳/級別/模組/消息），不需結尾 \n
 */
export function writeLine(source: LogSource, line: string): void {
  if (!initialized) return

  const fileName = `${source}-${todayStr()}.log`
  const filePath = join(logsDir, fileName)

  // 異步追加；失敗只在 console 報告，不拋異常
  appendFile(filePath, line.endsWith('\n') ? line : line + '\n', 'utf-8', (err) => {
    if (err) {
      // 用原生 console 而不走 logger，避免循環依賴
      console.error('[LogFileWriter] 寫入失敗:', err.message)
    }
  })
}

/**
 * 取日誌目錄絕對路徑。
 * 用於：「打開日誌資料夾」按鈕、上傳日誌功能。
 */
export function getLogsDir(): string {
  return logsDir
}

/** 今日日期字串 YYYY-MM-DD */
function todayStr(): string {
  const d = new Date()
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

/**
 * 清理 RETENTION_DAYS 天以上的舊日誌。
 * 啟動時跑一次即可，用戶不會 14 天不重啟。
 */
function cleanupOldLogs(): void {
  try {
    const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000
    const files = readdirSync(logsDir)
    let deleted = 0

    for (const file of files) {
      // 只清自己的 .log，不要誤刪其他工具的檔
      if (!/^(main|renderer)-\d{4}-\d{2}-\d{2}\.log$/.test(file)) continue

      const fullPath = join(logsDir, file)
      const mtime = statSync(fullPath).mtimeMs
      if (mtime < cutoff) {
        unlinkSync(fullPath)
        deleted++
      }
    }

    if (deleted > 0) {
      console.info(`[LogFileWriter] 清理 ${deleted} 個過期日誌文件（>${RETENTION_DAYS} 天）`)
    }
  } catch (err) {
    console.error('[LogFileWriter] 清理舊日誌失敗:', err)
  }
}
