/**
 * 主進程日誌工具（console + 文件雙輸出）。
 * 用於：所有主進程模塊；autoUpdater.logger 也接到這裡統一格式。
 * 文件寫入需先呼叫 initLogFileWriter()，之前的 logger 呼叫只走 console。
 */

import { writeLine } from './log-file-writer'

/** 本地時間毫秒精度時間戳，例 2026-04-29 14:35:22.123（不用 toISOString，那是 UTC） */
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

  // Error → message + stack；其他 JSON.stringify
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
 * 寫文件策略：只有 error 級別會落地。
 * 想讓某些「重要 info」也落地請改用 logger.error 或新增專用 channel，
 * 不要放寬 info 規則 —— 否則錯誤會被海量無用日誌淹沒。
 */
export const logger = {
  /** 調試（僅 dev console） */
  debug(message: string, module?: string, ...args: unknown[]): void {
    if (process.env.NODE_ENV !== 'production') {
      console.debug(formatLine('DEBUG', message, module, args))
    }
  },

  /** 普通信息（僅 console） */
  info(message: string, module?: string, ...args: unknown[]): void {
    console.info(formatLine('INFO', message, module, args))
  },

  /** 警告（僅 console） */
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
 * 渲染進程日誌入口，寫到 renderer-YYYY-MM-DD.log。
 * 用於：ipc-handlers/log.handlers.ts 收 IPC 後呼叫；渲染端不直接呼叫。
 */
export function writeRendererLog(
  level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR',
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

  // 跟主進程一致：只 ERROR 寫文件
  if (level === 'ERROR') {
    writeLine('renderer', line)
  }
}
