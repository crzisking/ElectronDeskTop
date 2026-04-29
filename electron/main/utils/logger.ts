/**
 * 主進程日誌工具
 *
 * 兩個輸出端：
 *  1. console（保留現狀，開發時 IDE 控制台直接看）
 *  2. 文件（log-file-writer，按日輪轉到 <userData>/logs/main-YYYY-MM-DD.log）
 *
 * 文件寫入需要先呼叫 initLogFileWriter()（在 app.whenReady 之後），
 * 在那之前的 logger 呼叫只會走 console，不會丟到文件。
 *
 * ── 為什麼自己寫而不用 electron-log ──────────────────────────────────
 * 1. electron-log 體積中等且 API 設計與我們現有 logger 不同
 * 2. 自己寫的好處：與專案風格一致；可以精確控制格式、輪轉、清理策略
 * 3. autoUpdater.logger 也統一接到本 logger，所有日誌全部進同一個檔
 *
 * 日誌級別：debug < info < warn < error
 *  - debug：只在非 production 環境輸出（高頻、瑣碎）
 *  - info / warn / error：所有環境都輸出
 */

import { writeLine } from './log-file-writer'

/** ISO 格式時間戳（毫秒精度），例如 2026-04-29 14:35:22.123 */
function timestamp(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 23)
}

/** 統一行格式 `[timestamp] [LEVEL][module] message [args]` */
function formatLine(level: string, message: string, module?: string, args?: unknown[]): string {
  const mod = module ? `[${module}]` : ''
  let line = `[${timestamp()}] [${level}]${mod} ${message}`

  // args 部分：把 Error 物件展開為 message + stack；其他用 JSON.stringify
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

/**
 * 寫文件的策略：
 *  - 只有 error 級別會落地到文件（生產環境只關心錯誤）
 *  - debug / info / warn 只走 console（開發時 IDE 看，生產不留檔以避免日誌爆炸）
 *
 * 若將來需要某些「重要 info」也落地，請改用 logger.error 或新增專用 channel，
 * 不要放寬 info 的寫文件規則 —— 那會讓錯誤被海量無用日誌淹沒。
 */
export const logger = {
  /** 調試信息（僅 console，dev 模式才輸出） */
  debug(message: string, module?: string, ...args: unknown[]): void {
    if (process.env.NODE_ENV !== 'production') {
      console.debug(formatLine('DEBUG', message, module, args))
    }
  },

  /** 普通信息（僅 console，不寫文件） */
  info(message: string, module?: string, ...args: unknown[]): void {
    console.info(formatLine('INFO', message, module, args))
  },

  /** 警告（僅 console，不寫文件） */
  warn(message: string, module?: string, ...args: unknown[]): void {
    console.warn(formatLine('WARN', message, module, args))
  },

  /** 錯誤（console + 文件，唯一會落地的級別） */
  error(message: string, module?: string, ...args: unknown[]): void {
    const line = formatLine('ERROR', message, module, args)
    console.error(line)
    writeLine('main', line)
  }
}

/**
 * 給渲染進程日誌使用的入口（內部呼叫，渲染端不直接呼叫此函數）。
 * 渲染日誌走的格式跟主進程一樣，只是寫到 renderer-YYYY-MM-DD.log。
 *
 * 給 ipc-handlers/log.handlers.ts 用，把 IPC 收到的日誌寫到文件。
 */
export function writeRendererLog(
  level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR',
  message: string,
  module?: string,
  args?: unknown[]
): void {
  const line = formatLine(level, message, module, args)

  // 開發環境鏡像到主進程 console，方便聯調
  if (process.env.NODE_ENV !== 'production') {
    const out =
      level === 'ERROR' ? console.error :
      level === 'WARN'  ? console.warn :
      level === 'DEBUG' ? console.debug : console.info
    out(`[Renderer] ${line}`)
  }

  // 跟主進程一致：只有 ERROR 級別寫文件
  if (level === 'ERROR') {
    writeLine('renderer', line)
  }
}
