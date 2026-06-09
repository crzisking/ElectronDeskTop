/**
 * 渲染進程日誌工具
 *
 * ─── 兩種呼叫法(向後兼容,對齊主進程 logger) ──────────────────────────
 *
 *   1. 舊式(module 是字串):
 *        logger.info('登錄成功', 'auth.store')
 *        logger.error('IPC 失敗', 'work-collect.store', err)
 *
 *   2. 新式(結構化欄位 — 跨模組關聯 / 量化耗時用):
 *        import {newTraceId} from '@/shared/utils/logger'
 *        const traceId = newTraceId()
 *        logger.info('登錄開始', {module: 'auth.store', traceId})
 *        ...
 *        logger.info('登錄完成', {
 *          module: 'auth.store',
 *          traceId,
 *          durationMs: Date.now() - startedAt,
 *          userName,
 *        })
 *
 * 寫入路徑:
 *  - console(瀏覽器 DevTools,dev 模式下可見)
 *  - 主進程 SQLite(IPC 轉發,全等級)
 *  - 主進程 txt 檔(IPC 轉發,**只 ERROR**)
 *
 * ─── 日誌參數規範 ─────────────────────────────────────────────────────
 *   message:固定字串描述(grep 可作為錨點)
 *   module:來源模塊名稱,建議 `feature.layer` 格式(例 `auth.store`)
 *   args:動態數據(error 物件、response、上下文對象)
 *
 * ─── 安全考量 ─────────────────────────────────────────────────────────
 * 不要把 token、密碼等敏感資訊放進 args / meta。
 */

type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'

/** 對齊主進程 LogContext;module / traceId / durationMs 是保留欄位,其餘塞 meta */
export interface LogContext {
    module?: string
    traceId?: string
    durationMs?: number

    [key: string]: unknown
}

/**
 * 生成 16-char hex traceId,給跨模組關聯用。
 * crypto.randomUUID 在 prod electron renderer 可用(secure context = false 也可,
 * Electron renderer 預設 isolated context 但 crypto 內建)。為穩定走 getRandomValues。
 */
export function newTraceId(): string {
    const bytes = new Uint8Array(8)
    crypto.getRandomValues(bytes)
    return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** 把第二參數正規化:string → {module},object → 拆出保留欄位 + 其餘塞 meta */
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
    return {module, traceId, durationMs, meta: hasRest ? rest : undefined}
}

/**
 * 將不可序列化的對象轉成可送進 IPC 的形式。
 * Electron IPC 用 structured clone,不能傳 Function;Error 雖然可以但跨進程後 stack
 * 可能丟失,這裡先處理成純物件。
 */
function sanitizeArg(arg: unknown): unknown {
    if (arg instanceof Error) {
        return {
            __error__: true,
            name: arg.name,
            message: arg.message,
            stack: arg.stack,
        }
    }
    if (typeof arg === 'function') return '[Function]'
    if (typeof arg === 'undefined') return null
    return arg
}

/** 把日誌轉發到主進程寫文件 + DB。preload 之前不可用時靜默 noop */
function forwardToMain(
    level: LogLevel,
    message: string,
    module?: string,
    args?: unknown[],
    context?: { traceId?: string; durationMs?: number; meta?: Record<string, unknown> },
): void {
    if (typeof window === 'undefined' || !window.electronAPI?.log) return
    try {
        window.electronAPI.log.write({
            level,
            message,
            module,
            args: args?.map(sanitizeArg),
            traceId: context?.traceId,
            durationMs: context?.durationMs,
            meta: context?.meta,
        })
    } catch {
        // IPC 寫入失敗不要影響業務代碼,靜默吞掉
    }
}

/** 本地時間毫秒精度時間戳 */
function localTimestamp(): string {
    const d = new Date()
    const pad = (n: number, w = 2) => String(n).padStart(w, '0')
    return (
        `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
        `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.` +
        `${pad(d.getMilliseconds(), 3)}`
    )
}

/** Console 前綴,跟主進程對齊;traceId / durationMs 有值才印 */
function consolePrefix(level: LogLevel, module?: string, traceId?: string, durationMs?: number): string {
    const mod = module ? `[${module}]` : ''
    const trace = traceId ? ` (trace:${traceId.slice(0, 8)})` : ''
    const dur = durationMs != null ? ` (${durationMs}ms)` : ''
    return `[${localTimestamp()}] [${level}]${mod}${trace}${dur}`
}

const isDev = import.meta.env.DEV

/**
 * 統一寫入入口,所有等級走這條。差別在 console method / 是否 forward。
 */
function writeOne(
    level: LogLevel,
    consoleFn: (...args: unknown[]) => void,
    message: string,
    moduleOrCtx?: string | LogContext,
    args?: unknown[],
): void {
    const {module, traceId, durationMs, meta} = normalizeContext(moduleOrCtx)
    // dev 才印 console(對齊主進程「DEBUG 只 dev console」邏輯)
    if (level !== 'DEBUG' || isDev) {
        consoleFn(consolePrefix(level, module, traceId, durationMs), message, ...(args ?? []))
    }
    // 所有等級都 forward,主進程那端會處理「DEBUG 不落庫」的分流
    forwardToMain(level, message, module, args, {traceId, durationMs, meta})
}

export const logger = {
    /** 調試信息(console:dev 才印;forward:全環境,讓主進程 DB 拿到完整時間線) */
    debug(message: string, moduleOrCtx?: string | LogContext, ...args: unknown[]): void {
        writeOne('DEBUG', console.debug, message, moduleOrCtx, args)
    },
    /** 普通信息(console + forward) */
    info(message: string, moduleOrCtx?: string | LogContext, ...args: unknown[]): void {
        writeOne('INFO', console.info, message, moduleOrCtx, args)
    },
    /** 警告(console + forward) */
    warn(message: string, moduleOrCtx?: string | LogContext, ...args: unknown[]): void {
        writeOne('WARN', console.warn, message, moduleOrCtx, args)
    },
    /** 錯誤(console + forward;主進程那端唯一會落地 txt 的等級) */
    error(message: string, moduleOrCtx?: string | LogContext, ...args: unknown[]): void {
        writeOne('ERROR', console.error, message, moduleOrCtx, args)
    },
}

/**
 * 全局未捕獲異常 / Promise rejection 自動寫日誌。
 * 在 main.ts 呼叫一次:installGlobalErrorHandlers()
 */
export function installGlobalErrorHandlers(): void {
    window.addEventListener('error', (event) => {
        logger.error(
            `Uncaught error: ${event.message}`,
            'global.error-handler',
            {
                filename: event.filename,
                lineno: event.lineno,
                colno: event.colno,
                error: event.error instanceof Error
                    ? {name: event.error.name, message: event.error.message, stack: event.error.stack}
                    : event.error,
            },
        )
    })

    window.addEventListener('unhandledrejection', (event) => {
        const reason = event.reason
        const message = reason instanceof Error ? reason.message : String(reason)
        logger.error(
            `Unhandled Promise rejection: ${message}`,
            'global.error-handler',
            reason,
        )
    })

    logger.info('全局錯誤處理已啟用', 'global.error-handler')
}
