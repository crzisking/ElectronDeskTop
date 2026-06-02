/**
 * 日誌查看器子視窗 preload。
 *
 * 只暴露最小 API:logQuery 查 logs 表。
 * 不需要 log.write / config / 浮球等其他 API —— 子視窗目的單一,縮減暴露面降低風險。
 *
 * ⚠️ channel 內聯不走 @shared/ipc-channels 的原因:
 *   sandbox: true 下 Electron 不解析 chunks/,3 個 preload 共用模組會被 Rollup 抽 chunk。
 *   見 floating-ball.preload.ts 內的說明。
 *
 * 🔗 source of truth:electron/shared/ipc-channels/log.ts(LOG_QUERY)
 */

import {contextBridge, ipcRenderer} from 'electron'

const IPC = {
  LOG_QUERY: 'log-viewer:query',
    LOG_LIST_MODULES: 'log-viewer:list-modules',
    // 採集健康狀態。只在密碼保護的日誌查看器窗口暴露,普通使用者不可見。
    // 🔗 source of truth:electron/shared/ipc-channels/work-collect.ts(WORK_COLLECT_HEALTH)
    WORK_HEALTH: 'work:health',
} as const

/** 採集健康狀態(對齊主進程 WORK_COLLECT_HEALTH 返回) */
interface WorkHealth {
    pendingSync: number
    writeFailures: number
    markFailures: number
    lastError: string | null
    lastErrorAt: number | null
}

/** 跟主進程 LogService.query 對齊 */
interface LogQueryParams {
  level?: 'debug' | 'info' | 'warn' | 'error' | ('debug' | 'info' | 'warn' | 'error')[]
  source?: 'main' | 'renderer'
  module?: string
  since?: number
  until?: number
  search?: string
  limit?: number
  offset?: number
}

contextBridge.exposeInMainWorld('logViewerAPI', {
  /** 查詢日誌。失敗(例如未解鎖)會 reject */
  query: (params: LogQueryParams) => ipcRenderer.invoke(IPC.LOG_QUERY, params),
    /** 取所有出現過的模組名(按頻率倒序),給下拉用 */
    listModules: () => ipcRenderer.invoke(IPC.LOG_LIST_MODULES) as Promise<string[]>,
    /** 採集健康狀態:待同步數 / 失敗計數 / 最後錯誤 */
    workHealth: () => ipcRenderer.invoke(IPC.WORK_HEALTH) as Promise<WorkHealth>,
})
