/**
 * 窗口控制 IPC Handler。
 *
 * 涵蓋:
 *  - WINDOW_*:主視窗最小化 / 最大化 / 關閉 / 顯示 / 隱藏 / 查詢最大化狀態
 *  - OPEN_CHILD_WINDOW:統一平台卡片 (openMode='electron-window') 開外部 URL 的子視窗
 *
 * 用於:主視窗自訂標題欄按鈕 + 統一平台頁。
 */

import {ipcMain} from 'electron'
import {IpcChannels} from '../../shared/ipc-channels'
import {logger} from '../utils/logger'
import type {WindowManager} from '../window-manager'
import type {ConfigManager} from '../config-manager'

/**
 * 註冊所有窗口控制 IPC Handler。
 * @param windowManager 視窗管理器
 * @param configManager 配置管理器(OPEN_CHILD_WINDOW 需要讀 unifiedPlatform.systems 做白名單)
 */
export function registerWindowHandlers(
  windowManager: WindowManager,
  configManager: ConfigManager
): void {
  ipcMain.on(IpcChannels.WINDOW_MINIMIZE, () => {
    const win = windowManager.getMainWindow()
    win?.minimize()
    logger.debug('主窗口已最小化', 'IPC:window')
  })

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

  // 關閉 = 隱藏主窗口並切換到浮球，並非真正退出
  ipcMain.on(IpcChannels.WINDOW_CLOSE, () => {
    windowManager.hideMainWindow()
    logger.debug('主窗口已關閉（切換到浮球）', 'IPC:window')
  })

  ipcMain.on(IpcChannels.WINDOW_SHOW, () => {
    windowManager.showMainWindow()
    logger.debug('主窗口已顯示', 'IPC:window')
  })

  ipcMain.on(IpcChannels.WINDOW_HIDE, () => {
    windowManager.hideMainWindow()
    logger.debug('主窗口已隱藏', 'IPC:window')
  })

  ipcMain.handle(IpcChannels.WINDOW_IS_MAXIMIZED, () => {
    const win = windowManager.getMainWindow()
    return win?.isMaximized() ?? false
  })

  /**
   * OPEN_CHILD_WINDOW:用 electron-window 模式打開子視窗。
   *
   * 用於統一平台頁卡片 openMode='electron-window'(避開 iframe X-Frame-Options 限制)。
   * 安全策略:從 app-config.json 的系統列表抽出域名作白名單,只放行已配置的系統 URL,
   * 避免渲染端能任意傳 URL 開新窗。
   */
  ipcMain.handle(IpcChannels.OPEN_CHILD_WINDOW, (_event, url: string, title: string) => {
    const config = configManager.getConfig()
    const allowedDomains = config.unifiedPlatform.systems
      .map((sys) => {
        try {
          return new URL(sys.url).hostname
        } catch {
          return ''
        }
      })
      .filter(Boolean)

    windowManager.openChildWindow(url, title, allowedDomains)
    logger.info(`打開子窗口: ${title}`, 'IPC:window')
  })

  /** 拉起代辦錄入窗(docs/23,等同全域熱鍵 Ctrl+/);已開則 show+focus,未開則 create */
  ipcMain.handle(IpcChannels.WINDOW_OPEN_TODO_CAPTURE, () => {
    windowManager.createTodoCaptureWindow()
    logger.info('拉起代辦錄入窗', 'IPC:window')
  })

    /** 打開 AI Agent 獨立窗(docs/19);已開則 focus,未開則 create */
    ipcMain.handle(IpcChannels.WINDOW_OPEN_AGENT, () => {
        windowManager.createAgentWindow()
        logger.info('打開 AI Agent 視窗', 'IPC:window')
    })

    /** 打開靈感速記速記小窗(docs/21);已開則 show+focus,未開則 create */
    ipcMain.handle(IpcChannels.WINDOW_OPEN_IDEA_CAPTURE, () => {
        windowManager.createIdeaCaptureWindow()
        logger.info('打開靈感速記視窗', 'IPC:window')
    })

  logger.info('窗口 IPC Handlers 已註冊', 'IPC:window')
}
