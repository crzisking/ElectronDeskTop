/**
 * 日誌寫入 / 查看器 / 解鎖相關 IPC channels。
 */
export const LogChannels = {
  /**
   * LOG_WRITE:渲染端 logger 寫一筆日誌進主進程,落地到 logs.db + .txt + console。
   * send。payload:LogEntry({ level, message, source, time, args[] })
   */
  LOG_WRITE: 'log:write',

  /** LOG_OPEN_FOLDER:在系統檔案總管中打開日誌資料夾 */
  LOG_OPEN_FOLDER: 'log:open-folder',

  /**
   * LOG_VIEWER_UNLOCK:渲染端輸入密碼解鎖日誌查看器。
   * 主進程驗證密碼後設定 unlocked flag,後續 LOG_QUERY 才會放行。
   * invoke。返回:boolean(密碼正確 / 錯誤)
   */
  LOG_VIEWER_UNLOCK: 'log-viewer:unlock',

  /**
   * LOG_QUERY:查詢 logs 表。未解鎖 session 主進程直接 throw。
   * invoke。payload:LogQueryParams。返回:{ rows, total }
   */
  LOG_QUERY: 'log-viewer:query',

    /**
     * LOG_LIST_MODULES:取 logs 表中所有 distinct module 名稱(給下拉用)。
     * 未解鎖 session 主進程直接 throw。invoke。返回:string[]
     */
    LOG_LIST_MODULES: 'log-viewer:list-modules',

  /** WINDOW_OPEN_LOG_VIEWER:開啟日誌查看器子視窗(必須先 unlock)。send */
  WINDOW_OPEN_LOG_VIEWER: 'window:open-log-viewer',
} as const
