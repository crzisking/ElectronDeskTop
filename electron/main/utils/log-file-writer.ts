/**
 * 日誌文件寫入器（按日輪轉）
 *
 * ── 職責 ─────────────────────────────────────────────────────────────
 * 把日誌追加到 txt 檔；按天分檔；自動清理超過保留期的舊檔。
 *
 * ── 為什麼獨立成一個 module ──────────────────────────────────────────
 * logger.ts 同時要做「格式化 + console 輸出 + 文件寫入」三件事，
 * 把文件寫入抽出來：
 *   1. logger.ts 保持簡潔（只關心格式 + 路由到不同輸出端）
 *   2. 文件相關邏輯（輪轉/清理/路徑）集中一處，易修改
 *   3. 方便測試：可獨立 mock 文件寫入
 *
 * ── 文件位置 ─────────────────────────────────────────────────────────
 * 生產環境：%APPDATA%/<productName>/logs/
 *           例如：C:\Users\Admin\AppData\Roaming\enterprise-desktop-client\logs\
 * 開發環境：項目根目錄 logs/
 *           （app.getPath('userData') 開發時也是 AppData 下，
 *            為了開發方便我們強制指向專案根目錄）
 *
 * ── 文件命名 ─────────────────────────────────────────────────────────
 * main-2026-04-29.log       主進程日誌
 * renderer-2026-04-29.log   渲染進程日誌
 *
 * ── 異步寫入策略 ──────────────────────────────────────────────────────
 * 用 fs.appendFile（異步）寫入，避免阻塞主進程。
 * 寫入失敗只 console.error，不影響應用運行。
 */

import { app } from 'electron'
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync, appendFile } from 'fs'
import { join } from 'path'

/** 日誌來源類型，決定寫到哪個文件 */
export type LogSource = 'main' | 'renderer'

/** 保留天數：超過此天數的舊日誌會在啟動時自動清理 */
const RETENTION_DAYS = 14

/** 是否已初始化（init 必須在 app.whenReady 之後呼叫） */
let initialized = false

/** 日誌目錄完整路徑（init 後賦值） */
let logsDir = ''

/**
 * 初始化日誌目錄並清理過期文件。
 * 必須在 app.whenReady() 之後、任何寫入動作之前呼叫一次。
 *
 * 呼叫順序：electron/main/index.ts 的 whenReady 一開始就 init()。
 */
export function initLogFileWriter(): void {
  if (initialized) return

  // 解析日誌目錄
  if (app.isPackaged) {
    logsDir = join(app.getPath('userData'), 'logs')
  } else {
    // 開發環境：把日誌放專案根目錄的 logs/，便於查看
    logsDir = join(app.getAppPath(), 'logs')
  }

  // 確保目錄存在
  if (!existsSync(logsDir)) {
    mkdirSync(logsDir, { recursive: true })
  }

  // 清理過期文件
  cleanupOldLogs()

  initialized = true

  // 不在這裡寫啟動 banner —— 我們只記錄錯誤，沒錯誤就不該有檔案
  // 排查時若需要區分啟動會話，可以結合系統時鐘 + 文件創建時間判斷
}

/**
 * 寫入一行日誌到對應來源的文件。
 * init 之前呼叫會被靜默丟棄（避免在 app.whenReady 前寫入）。
 *
 * @param source 'main' 主進程 / 'renderer' 渲染進程
 * @param line   完整一行（已包含時間戳/級別/模組/消息），不需要結尾的 \n
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
 * 獲取日誌目錄絕對路徑。
 * 給「打開日誌資料夾」按鈕、或上傳日誌功能用。
 */
export function getLogsDir(): string {
  return logsDir
}

// ─── 內部工具 ───────────────────────────────────────────────────────

/** 今日日期字串（YYYY-MM-DD），用於文件名 */
function todayStr(): string {
  const d = new Date()
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

/**
 * 清理超過 RETENTION_DAYS 天的舊日誌文件。
 * 啟動時跑一次，不需要週期性清理（用戶不會跑 14 天不重啟）。
 */
function cleanupOldLogs(): void {
  try {
    const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000
    const files = readdirSync(logsDir)
    let deleted = 0

    for (const file of files) {
      // 只清理我們自己的 .log 檔，不要誤刪用戶/其他工具的檔
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
