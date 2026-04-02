/**
 * 主進程日誌工具
 *
 * 封裝 console 提供統一格式的日誌輸出。
 * 生產環境下可替換為 electron-log 等日誌庫持久化到文件。
 *
 * 日誌級別：debug < info < warn < error
 */

/** 獲取格式化時間戳 */
function timestamp(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 23)
}

/** 格式化日誌前綴 */
function prefix(level: string, module?: string): string {
  const mod = module ? `[${module}]` : ''
  return `[${timestamp()}] [${level}]${mod}`
}

export const logger = {
  /**
   * 調試信息（開發環境詳細輸出）
   * @param message 日誌信息
   * @param module  模塊名稱（可選，便於定位來源）
   * @param args    額外數據
   */
  debug(message: string, module?: string, ...args: unknown[]): void {
    if (process.env.NODE_ENV !== 'production') {
      console.debug(`${prefix('DEBUG', module)} ${message}`, ...args)
    }
  },

  /**
   * 普通信息
   */
  info(message: string, module?: string, ...args: unknown[]): void {
    console.info(`${prefix('INFO', module)} ${message}`, ...args)
  },

  /**
   * 警告（不影響程序運行，但需關注）
   */
  warn(message: string, module?: string, ...args: unknown[]): void {
    console.warn(`${prefix('WARN', module)} ${message}`, ...args)
  },

  /**
   * 錯誤（需要立即處理）
   */
  error(message: string, module?: string, ...args: unknown[]): void {
    console.error(`${prefix('ERROR', module)} ${message}`, ...args)
  }
}
