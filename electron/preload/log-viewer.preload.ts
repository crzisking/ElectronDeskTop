/**
 * 日誌查看器子視窗 preload。
 *
 * 只暴露最小 API:
 *  - logQuery:查 logs 表
 *  - close:關閉自己的視窗(原生 frame 已有 ✕,但提供 API 備用)
 *
 * 不需要 log.write / config / 浮球等其他 API —— 子視窗目的單一,
 * 縮減暴露面降低被誤用 / 攻擊風險。
 */

import {contextBridge, ipcRenderer} from 'electron'

const IPC = {
  LOG_QUERY: 'log-viewer:query',
} as const

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
})
