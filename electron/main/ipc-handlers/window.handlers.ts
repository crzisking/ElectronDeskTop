/**
 * 窗口控制 IPC Handler
 *
 * 處理渲染進程發來的窗口操作命令：
 *  - 最小化、最大化、關閉（隱藏）、顯示、隱藏
 *  - 查詢最大化狀態
 *
 * 所有 Handler 通過 registerWindowHandlers() 統一注冊。
 */

import { ipcMain } from 'electron'
import { IpcChannels } from '../../shared/ipc-channels'
import { logger } from '../utils/logger'
import type { WindowManager } from '../window-manager'

/**
 * 注冊所有窗口控制 IPC Handler
 * @param windowManager 窗口管理器實例
 */
export function registerWindowHandlers(windowManager: WindowManager): void {
  // ─── 最小化 ──────────────────────────────────────────────────
  ipcMain.on(IpcChannels.WINDOW_MINIMIZE, () => {
    const win = windowManager.getMainWindow()
    win?.minimize()
    logger.debug('主窗口已最小化', 'IPC:window')
  })

  // ─── 最大化切換 ──────────────────────────────────────────────
  ipcMain.on(IpcChannels.WINDOW_MAXIMIZE, () => {
    const win = windowManager.getMainWindow()
    if (!win) return
    if (win.isMaximized()) {
      win.unmaximize()
      logger.debug('主窗口已還原', 'IPC:window')
    } else {
      win.maximize()
      logger.debug('主窗口已最大化', 'IPC:window')
    }
  })

  // ─── 關閉主窗口（隱藏 + 顯示浮球） ──────────────────────────
  ipcMain.on(IpcChannels.WINDOW_CLOSE, () => {
    windowManager.hideMainWindow()
    logger.debug('主窗口已關閉（切換到浮球）', 'IPC:window')
  })

  // ─── 顯示主窗口 ──────────────────────────────────────────────
  ipcMain.on(IpcChannels.WINDOW_SHOW, () => {
    windowManager.showMainWindow()
    logger.debug('主窗口已顯示', 'IPC:window')
  })

  // ─── 隱藏主窗口 ──────────────────────────────────────────────
  ipcMain.on(IpcChannels.WINDOW_HIDE, () => {
    windowManager.hideMainWindow()
    logger.debug('主窗口已隱藏', 'IPC:window')
  })

  // ─── 查詢是否最大化（invoke/handle 模式，需要返回值） ────────
  ipcMain.handle(IpcChannels.WINDOW_IS_MAXIMIZED, () => {
    const win = windowManager.getMainWindow()
    return win?.isMaximized() ?? false
  })

  logger.info('窗口 IPC Handlers 已注冊', 'IPC:window')
}
