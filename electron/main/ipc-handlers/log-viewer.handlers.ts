/**
 * 日誌查看器 IPC handler。
 *
 * 3 個 channel:
 *  - LOG_VIEWER_UNLOCK:渲染端送密碼比對,成功則本 session 標記為已解鎖
 *  - LOG_QUERY:查詢 logs 表(僅限已解鎖 session)
 *  - WINDOW_OPEN_LOG_VIEWER:打開子視窗(也要先解鎖)
 *
 * 密碼為什麼放主進程:
 *  - 渲染端有 DevTools,常數一秒被看光
 *  - 主進程在 app.asar 內,雖然不是強加密但門檻高,擋一般使用者誤觸發足夠
 *  - 此密碼定位是「**防呆**」不是「真資安」—— 內部排查工具,不對外
 *
 * 解鎖狀態管理:
 *  - 用模組級變數 _unlocked,跟 logger 內 _logService 同樣模式
 *  - 只活在當前 App 進程,完全結束後重啟自動歸 false
 *  - 不持久化,管理員每次重啟都要重輸密碼(這是 feature,不是 bug)
 */

import {ipcMain} from 'electron'
import {IpcChannels} from '../../shared/ipc-channels'
import {logger} from '../utils/logger'
import type {LogService, LogQueryParams} from '../db/features/logs/service'
import type {WindowManager} from '../window-manager'

/**
 * 寫死的密碼。
 * 改密碼:改這個常數重新打包即可,沒有遠端推送機制(也不需要)。
 */
const LOG_VIEWER_PASSWORD = 'ichia'

/** 本 session 是否已解鎖。App 重啟自動歸 false */
let _unlocked = false

/** 給其他模組查詢用(本檔內 handler 自用 + window-manager 開窗時也要再驗) */
export function isLogViewerUnlocked(): boolean {
  return _unlocked
}

export function registerLogViewerHandlers(
  logService: LogService | null,
  windowManager: WindowManager
): void {
  // ── 解鎖 ─────────────────────────────────────────────────────────
  ipcMain.handle(IpcChannels.LOG_VIEWER_UNLOCK, (_event, password: unknown) => {
    if (typeof password !== 'string') return false
    if (password !== LOG_VIEWER_PASSWORD) {
      logger.warn('日誌查看器密碼錯誤', 'LogViewer')
      return false
    }
    _unlocked = true
    logger.info('日誌查看器已解鎖(本次 session)', 'LogViewer')
    return true
  })

  // ── 查詢 ─────────────────────────────────────────────────────────
  ipcMain.handle(IpcChannels.LOG_QUERY, (_event, params: LogQueryParams) => {
    if (!_unlocked) {
      // 未解鎖直接拋,避免任何洩漏。渲染端 invoke 會 reject
      throw new Error('Forbidden: log viewer is locked')
    }
    if (!logService) {
      // DB 初始化失敗時 logService 是 null,回空結果不報錯
      return {rows: [], total: 0}
    }
    return {
      rows: logService.query(params),
      total: logService.count(params),
    }
  })

  // ── 開子視窗 ─────────────────────────────────────────────────────
  ipcMain.on(IpcChannels.WINDOW_OPEN_LOG_VIEWER, () => {
    if (!_unlocked) {
      logger.warn('日誌查看器未解鎖時嘗試開啟子視窗,已阻止', 'LogViewer')
      return
    }
    windowManager.createLogViewerWindow()
  })
}
