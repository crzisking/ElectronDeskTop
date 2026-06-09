/**
 * 主進程日誌工具(console + 文件 + SQLite 三輸出)。
 *
 * 用於:所有主進程模塊;autoUpdater.logger 也接到這裡統一格式。
 *
 * ─── 兩種呼叫法(向後兼容) ──────────────────────────────────────────────
 *
 *   1. 舊式(module 是字串):
 *        logger.info('sync 完成', 'work-collect.sync')
 *        logger.error('連線失敗', 'notification.client', err)
 *
 *   2. 新式(帶結構化欄位 — 跨模組關聯 / 量化耗時用):
 *        const traceId = newTraceId()
 *        logger.info('sync 開始', {module: 'work-collect.sync', traceId})
 *        ...
 *        logger.info('sync 完成', {
 *          module: 'work-collect.sync',
 *          traceId,
 *          durationMs: Date.now() - startedAt,
 *          synced: total,
 *          failed,
 *        })
 *
 *   兩種可混用 — 舊呼叫不動,新熱點漸進改寫即可。
 *
 * ─── 寫入端策略(刻意分級,避免 DB 被高頻 debug 淹沒) ──────────────────
 *  - console:全等級
 *  - 文件(writeLine):只 ERROR
 *  - SQLite(_logService.write):info / warn / error 才寫;**debug 不落庫**
 *
 * 設計文件:[docs/08-本地數據庫設計.md §12-§13](../../../docs/08-本地數據庫設計.md)
 */

import {app} from 'electron'
import {randomBytes} from 'crypto'
import {writeLine} from './log-file-writer'
import type {LogLevel} from '../db/features/logs/schema'
import type {LogService} from '../db/features/logs/service'

/**
 * dev / prod 判定。用 app.isPackaged 而不是 process.env.NODE_ENV — 後者依賴 vite define
 * 構建時替換,換構建工具會失效。app.isPackaged 是 Electron 原生 API,prod 打包後永遠 true。
 */
const isDev = !app.isPackaged

// ─── 結構化欄位介面 ───────────────────────────────────────────────────

/**
 * Logger 第二參數可傳 object 形式,把結構化欄位拉出 message 字串。
 * - module / traceId / durationMs 是保留欄位
 * - 其他任意 key 序列化進 meta JSON,LogViewer 可展開檢視
 */
export interface LogContext {
  /** 模組標籤;命名建議 `feature.layer`,例 `notification.client` / `work-collect.sync` */
  module?: string
  /**
   * 跨模組關聯 ID。同一個業務操作(登入 / sync session / dispatch task ...)
   * 內的所有 log 共用同個 ID,LogViewer 點 ID 一鍵過濾全部相關 log。
   * 用 newTraceId() 生成。
   */
  traceId?: string
  /** 操作耗時(ms);量化效能,排查「為什麼變慢」很省力 */
  durationMs?: number

  /** 其他任意 K/V,序列化進 meta 欄位。例 {synced: 5, userName: 'X'} */
  [key: string]: unknown
}

/**
 * 生成 16-char hex traceId(64-bit 隨機,單機 / 短期使用碰撞機率忽略不計)。
 * 不用 crypto.randomUUID() 是因為 36 char UUID 太長,日誌可讀性差。
 */
export function newTraceId(): string {
  return randomBytes(8).toString('hex')
}

/**
 * 把 logger 第二參數正規化:
 *   - string → 視為 module
 *   - LogContext object → 拆出保留欄位,其餘塞 meta
 * 統一回傳 {module, traceId, durationMs, meta} 給下游用。
 */
function normalizeContext(moduleOrCtx?: string | LogContext): {
  module?: string
  traceId?: string
  durationMs?: number
  meta?: Record<string, unknown>
} {
  if (moduleOrCtx == null) return {}
  if (typeof moduleOrCtx === 'string') return {module: moduleOrCtx}

  const {module, traceId, durationMs, ...rest} = moduleOrCtx
  const hasRest = Object.keys(rest).length > 0
  return {
    module,
    traceId,
    durationMs,
    meta: hasRest ? rest : undefined,
  }
}

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

/**
 * 行格式 `[timestamp] [LEVEL][module] (traceId:abcd) (123ms) message [args]`。
 * traceId / durationMs 有值才印,沒有就省略保持簡潔。
 */
function formatLine(
    level: string,
    message: string,
    module?: string,
    traceId?: string,
    durationMs?: number,
    args?: unknown[],
): string {
  const mod = module ? `[${module}]` : ''
  const trace = traceId ? ` (trace:${traceId.slice(0, 8)})` : ''
  const dur = durationMs != null ? ` (${durationMs}ms)` : ''
  let line = `[${timestamp()}] [${level}]${mod}${trace}${dur} ${message}`

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
 * 寫一條 log 的內部統一入口。所有等級走這條,差別在 console method / 是否寫文件 / 是否寫 DB。
 */
function writeOne(
    level: LogLevel,
    consoleFn: (msg: string) => void,
    alsoFile: boolean,
    alsoDb: boolean,
    message: string,
    moduleOrCtx?: string | LogContext,
    args?: unknown[],
): void {
  const {module, traceId, durationMs, meta} = normalizeContext(moduleOrCtx)
  const line = formatLine(level.toUpperCase(), message, module, traceId, durationMs, args)
  consoleFn(line)
  if (alsoFile) writeLine('main', line)
  if (alsoDb) {
    _logService?.write({
      level,
      source: 'main',
      module,
      message,
      args,
      traceId,
      meta,
      durationMs,
    })
  }
}

export const logger = {
  /** 調試:僅 dev console,**不落庫**(高頻噪音不污染 DB) */
  debug(message: string, moduleOrCtx?: string | LogContext, ...args: unknown[]): void {
    if (isDev) writeOne('debug', console.debug, false, false, message, moduleOrCtx, args)
  },

  /** 普通信息(console + DB) */
  info(message: string, moduleOrCtx?: string | LogContext, ...args: unknown[]): void {
    writeOne('info', console.info, false, true, message, moduleOrCtx, args)
  },

  /** 警告(console + DB) */
  warn(message: string, moduleOrCtx?: string | LogContext, ...args: unknown[]): void {
    writeOne('warn', console.warn, false, true, message, moduleOrCtx, args)
  },

  /** 錯誤(console + 文件 + DB,唯一三輸出) */
  error(message: string, moduleOrCtx?: string | LogContext, ...args: unknown[]): void {
    writeOne('error', console.error, true, true, message, moduleOrCtx, args)
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

/** 渲染端透過 IPC 帶來的結構化欄位(對齊 LogContext) */
export interface RendererLogContext {
  module?: string
  traceId?: string
  durationMs?: number
  meta?: Record<string, unknown>
}

/**
 * 渲染進程日誌入口,寫到 renderer-YYYY-MM-DD.log + DB。
 * 用於:ipc-handlers/log.handlers.ts 收 IPC 後呼叫;渲染端不直接呼叫。
 */
export function writeRendererLog(
  level: RendererLevel,
  message: string,
  module?: string,
  args?: unknown[],
  context?: RendererLogContext,
): void {
  const traceId = context?.traceId
  const durationMs = context?.durationMs
  const meta = context?.meta
  const line = formatLine(level, message, module, traceId, durationMs, args)

  // dev 鏡像到主進程 console 方便聯調
  if (isDev) {
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

  // 跟主進程一致:debug 不落庫,info/warn/error 才寫 DB
  if (level !== 'DEBUG') {
    _logService?.write({
      level: LEVEL_MAP[level],
      source: 'renderer',
      module,
      message,
      args,
      traceId,
      meta,
      durationMs,
    })
  }
}
