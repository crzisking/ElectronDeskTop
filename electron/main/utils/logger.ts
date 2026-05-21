/**
 * 主進程日誌工具(console + 文件 + SQLite 三輸出)。
 *
 * 用於:所有主進程模塊;autoUpdater.logger 也接到這裡統一格式。
 *
 * 三個寫入端互相獨立:
 *  - console:永遠輸出(dev 看 terminal、生產 stderr 也保留)
 *  - 文件(writeLine):**只 ERROR** 寫,維持現狀;需先 initLogFileWriter()
 *  - SQLite(_logService.write):**所有等級**都寫,給後續查詢 / 排查用;
 *    需 index.ts 在 DatabaseManager 初始化成功後呼叫 attachLogService();
 *    沒呼叫 / 失敗時,所有 logger.* 對 DB 的寫入靜默 noop,不影響 console / 文件
 *
 * 設計文件:[docs/08-本地數據庫設計.md §12](../../../docs/08-本地數據庫設計.md)
 */

import {writeLine} from './log-file-writer'
import type {LogLevel} from '../db/features/logs/schema'
import type {LogService} from '../db/features/logs/service'

// ─── DB 後端注入 ────────────────────────────────────────────────────────
//
// 用模組級變數而非 constructor 注入,因為 logger 是模組 singleton,
// 全應用任何地方 import 都拿同一個。index.ts 啟動時呼叫 attachLogService(svc)
// 後,後續所有 logger.* 都會自動雙寫到 DB。DB init 失敗則永不呼叫此 fn,
// `_logService?.write(...)` 自動 noop。
let _logService: LogService | null = null

/**
 * 把 LogService 注入給 logger。
 * 由 index.ts 在 DatabaseManager.init() 成功之後呼叫一次。
 */
export function attachLogService(svc: LogService): void {
  _logService = svc
}

// ─── 行格式化 ─────────────────────────────────────────────────────────

/** 本地時間毫秒精度時間戳,例 2026-04-29 14:35:22.123(不用 toISOString,那是 UTC) */
function timestamp(): string {
  const d = new Date()
  const pad = (n: number, w = 2) => String(n).padStart(w, '0')
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.` +
    `${pad(d.getMilliseconds(), 3)}`
  )
}

/** 行格式 `[timestamp] [LEVEL][module] message [args]` */
function formatLine(level: string, message: string, module?: string, args?: unknown[]): string {
  const mod = module ? `[${module}]` : ''
  let line = `[${timestamp()}] [${level}]${mod} ${message}`

  // Error → message + stack;其他 JSON.stringify
  if (args && args.length > 0) {
    const argsStr = args
      .map((a) => {
        if (a instanceof Error) {
          return `\n  ${a.name}: ${a.message}\n  ${a.stack ?? ''}`
        }
        try {
          return ' ' + JSON.stringify(a)
        } catch {
          return ' ' + String(a)
        }
      })
      .join('')
    line += argsStr
  }

  return line
}

// ─── 主進程 logger ────────────────────────────────────────────────────

/**
 * 寫入策略:
 *  - console:全等級
 *  - 文件:**只 ERROR**(維持原行為,給支援人員拿 .txt 排查)
 *  - DB:全等級(透過 _logService?.write)
 *
 * 想讓某些「重要 info」也落地 .txt 請改用 logger.error,
 * 不要放寬 info 規則 — 否則錯誤會被海量無用日誌淹沒。
 */
export const logger = {
  /** 調試(僅 dev console + DB) */
  debug(message: string, module?: string, ...args: unknown[]): void {
    if (process.env.NODE_ENV !== 'production') {
      console.debug(formatLine('DEBUG', message, module, args))
    }
    _logService?.write({level: 'debug', source: 'main', module, message, args})
  },

  /** 普通信息(console + DB) */
  info(message: string, module?: string, ...args: unknown[]): void {
    console.info(formatLine('INFO', message, module, args))
    _logService?.write({level: 'info', source: 'main', module, message, args})
  },

  /** 警告(console + DB) */
  warn(message: string, module?: string, ...args: unknown[]): void {
    console.warn(formatLine('WARN', message, module, args))
    _logService?.write({level: 'warn', source: 'main', module, message, args})
  },

  /** 錯誤(console + 文件 + DB,唯一三輸出) */
  error(message: string, module?: string, ...args: unknown[]): void {
    const line = formatLine('ERROR', message, module, args)
    console.error(line)
    writeLine('main', line)
    _logService?.write({level: 'error', source: 'main', module, message, args})
  },
}

// ─── 渲染端日誌入口 ───────────────────────────────────────────────────

/** 上游(IPC handler)傳來的等級;大寫一致 */
type RendererLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'

/** 渲染端 → DB 的等級映射(大寫轉小寫) */
const LEVEL_MAP: Record<RendererLevel, LogLevel> = {
  DEBUG: 'debug',
  INFO: 'info',
  WARN: 'warn',
  ERROR: 'error',
}

/**
 * 渲染進程日誌入口,寫到 renderer-YYYY-MM-DD.log + DB。
 * 用於:ipc-handlers/log.handlers.ts 收 IPC 後呼叫;渲染端不直接呼叫。
 */
export function writeRendererLog(
  level: RendererLevel,
  message: string,
  module?: string,
  args?: unknown[]
): void {
  const line = formatLine(level, message, module, args)

  // dev 鏡像到主進程 console 方便聯調
  if (process.env.NODE_ENV !== 'production') {
    const out =
      level === 'ERROR' ? console.error :
      level === 'WARN'  ? console.warn :
      level === 'DEBUG' ? console.debug : console.info
    out(`[Renderer] ${line}`)
  }

  // 跟主進程一致:只 ERROR 寫文件
  if (level === 'ERROR') {
    writeLine('renderer', line)
  }

  // 全等級寫 DB
  _logService?.write({level: LEVEL_MAP[level], source: 'renderer', module, message, args})
}
