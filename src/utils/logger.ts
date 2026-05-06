/**
 * 渲染進程日誌工具
 *
 * ── API 與主進程 logger 完全一致 ──────────────────────────────────────
 *   logger.debug(msg, module?, ...args)
 *   logger.info(msg, module?, ...args)
 *   logger.warn(msg, module?, ...args)
 *   logger.error(msg, module?, ...args)
 *
 * 寫入路徑：
 *  - console（瀏覽器 DevTools，dev 模式下可見）
 *  - 主進程文件（透過 IPC 轉發 → renderer-YYYY-MM-DD.log）
 *
 * ── 使用建議 ─────────────────────────────────────────────────────────
 * 任何 Vue 組件 / composable / store / api 攔截器中，凡是現在用
 * console.error / console.warn 的地方，改成：
 *   import { logger } from '@/utils/logger'
 *   logger.error('登錄失敗', 'auth.store', err)
 *
 * 這樣同一條訊息既會出現在 DevTools，也會落地到 txt 文件，
 * 生產環境用戶反映問題時，把 logs 資料夾打包發過來就能排查。
 *
 * ── 日誌參數規範 ──────────────────────────────────────────────────────
 *   message：固定字串描述（例如「請求失敗」），不要把動態數據拼進去
 *   module：來源模塊名稱（例如 'auth.store'、'IframeContainer'）
 *   args：動態數據（response、error 物件、上下文對象等）
 *
 * 這樣寫的好處：grep 文件時 message 可作為固定錨點。
 *
 * ── 為什麼不直接在渲染進程用 fs 寫文件 ────────────────────────────────
 * Electron 的 contextIsolation 安全機制下，渲染進程不能直接 require('fs')，
 * 必須通過 IPC 委託主進程寫文件。preload 層暴露 window.electronAPI.log.write，
 * 主進程的 log.handlers.ts 接收後寫到對應日期的 renderer 日誌文件。
 *
 * ── 安全考量 ─────────────────────────────────────────────────────────
 * 不要把 token、密碼等敏感資訊放進 args。雖然日誌只在本機，
 * 但用戶把日誌發給技術支援時可能不小心洩漏。
 */

type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'

/**
 * 將不可序列化的對象（如 Error、循環引用）轉成可送進 IPC 的形式。
 * Electron IPC 用 structured clone，不能傳 Function；Error 雖然可以但
 * 跨進程後 stack 可能丟失，這裡先處理成純物件。
 */
function sanitizeArg(arg: unknown): unknown {
  if (arg instanceof Error) {
    return {
      __error__: true,
      name: arg.name,
      message: arg.message,
      stack: arg.stack
    }
  }
  if (typeof arg === 'function') return '[Function]'
  if (typeof arg === 'undefined') return null
  return arg
}

/**
 * 把日誌轉發到主進程寫文件。
 * window.electronAPI 在 preload 之前不可用（理論上不會發生，因為渲染腳本
 * 必定在 preload 之後才執行），這裡保險檢查一下避免報錯。
 */
function forwardToMain(level: LogLevel, message: string, module?: string, args?: unknown[]): void {
  if (typeof window === 'undefined' || !window.electronAPI?.log) return
  try {
    window.electronAPI.log.write({
      level,
      message,
      module,
      args: args?.map(sanitizeArg)
    })
  } catch {
    // IPC 寫入失敗不要影響業務代碼，靜默吞掉
  }
}

/** 本地時間毫秒精度時間戳，例 2026-04-29 14:35:22.123（不用 toISOString，那是 UTC） */
function localTimestamp(): string {
  const d = new Date()
  const pad = (n: number, w = 2) => String(n).padStart(w, '0')
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.` +
    `${pad(d.getMilliseconds(), 3)}`
  )
}

/** 控制台輸出格式（與主進程 logger 對齊） */
function consolePrefix(level: LogLevel, module?: string): string {
  const mod = module ? `[${module}]` : ''
  return `[${localTimestamp()}] [${level}]${mod}`
}

/** 是否為 dev 模式（影響 debug 級別輸出） */
const isDev = import.meta.env.DEV

/**
 * 寫文件的策略：
 *  - 只有 error 級別會落地到 renderer-YYYY-MM-DD.log
 *  - debug / info / warn 只走 console
 *
 * 跟主進程 logger 對齊。生產環境只關心錯誤，info 級別在生產環境也只走 console
 * （DevTools 開不開都不影響——錯誤該寫的還是會寫）。
 */
export const logger = {
  /** 調試信息（僅 console，dev 模式才輸出） */
  debug(message: string, module?: string, ...args: unknown[]): void {
    if (!isDev) return
    console.debug(consolePrefix('DEBUG', module), message, ...args)
  },

  /** 普通信息（僅 console，不寫文件、不走 IPC） */
  info(message: string, module?: string, ...args: unknown[]): void {
    console.info(consolePrefix('INFO', module), message, ...args)
  },

  /** 警告（僅 console，不寫文件、不走 IPC） */
  warn(message: string, module?: string, ...args: unknown[]): void {
    console.warn(consolePrefix('WARN', module), message, ...args)
  },

  /** 錯誤（console + IPC 寫文件，唯一會落地的級別） */
  error(message: string, module?: string, ...args: unknown[]): void {
    console.error(consolePrefix('ERROR', module), message, ...args)
    forwardToMain('ERROR', message, module, args)
  }
}

/**
 * 全局未捕獲異常 / Promise rejection 自動寫日誌。
 * 在 main.ts 呼叫一次：installGlobalErrorHandlers()
 */
export function installGlobalErrorHandlers(): void {
  window.addEventListener('error', (event) => {
    logger.error(
      `Uncaught error: ${event.message}`,
      'GlobalErrorHandler',
      {
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        error: event.error instanceof Error
          ? { name: event.error.name, message: event.error.message, stack: event.error.stack }
          : event.error
      }
    )
  })

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason
    const message = reason instanceof Error ? reason.message : String(reason)
    logger.error(
      `Unhandled Promise rejection: ${message}`,
      'GlobalErrorHandler',
      reason
    )
  })

  logger.info('全局錯誤處理已啟用', 'GlobalErrorHandler')
}
