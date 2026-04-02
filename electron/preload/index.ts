/**
 * 主窗口預加載腳本（Preload Script）
 *
 * 這是渲染進程和主進程之間唯一的合法通信橋樑。
 *
 * 安全原則：
 *  - contextBridge.exposeInMainWorld：只暴露明確需要的 API
 *  - 不暴露 ipcRenderer 本身（防止渲染進程任意發送 IPC）
 *  - 每個暴露的方法都有明確的參數和返回值類型
 *  - 對傳入參數進行基本校驗（防止惡意代碼注入）
 *
 * 本腳本運行在：
 *  - Node.js 環境（可以 require）
 *  - 但被 contextIsolation 隔離（不污染渲染進程的 window）
 */

import { contextBridge, ipcRenderer } from 'electron'
import { IpcChannels } from '../shared/ipc-channels'

/**
 * 通過 contextBridge 將 electronAPI 安全暴露到渲染進程的 window 對象
 * 渲染進程通過 window.electronAPI.xxx() 調用
 */
contextBridge.exposeInMainWorld('electronAPI', {
  // ─── 配置管理 ──────────────────────────────────────────────
  config: {
    /**
     * 讀取應用配置
     * @returns Promise<AppConfig>
     */
    read: () => ipcRenderer.invoke(IpcChannels.CONFIG_READ),

    /**
     * 寫入部分配置
     * @param config Partial<AppConfig>
     */
    write: (config: unknown) => ipcRenderer.invoke(IpcChannels.CONFIG_WRITE, config)
  },

  // ─── 窗口控制 ──────────────────────────────────────────────
  window: {
    minimize: () => ipcRenderer.send(IpcChannels.WINDOW_MINIMIZE),
    maximize: () => ipcRenderer.send(IpcChannels.WINDOW_MAXIMIZE),
    close:    () => ipcRenderer.send(IpcChannels.WINDOW_CLOSE),
    show:     () => ipcRenderer.send(IpcChannels.WINDOW_SHOW),
    hide:     () => ipcRenderer.send(IpcChannels.WINDOW_HIDE),
    isMaximized: () => ipcRenderer.invoke(IpcChannels.WINDOW_IS_MAXIMIZED)
  },

  // ─── 浮球控制 ──────────────────────────────────────────────
  floatingBall: {
    show:      () => ipcRenderer.send(IpcChannels.BALL_SHOW),
    hide:      () => ipcRenderer.send(IpcChannels.BALL_HIDE),
    startDrag: () => ipcRenderer.send(IpcChannels.BALL_START_DRAG),
    stopDrag:  () => ipcRenderer.send(IpcChannels.BALL_STOP_DRAG),

    /**
     * 監聽浮球菜單操作（從浮球渲染進程中選擇菜單項後導航到主窗口對應路由）
     * 主進程收到浮球的菜單選擇後，通過此推送通知主窗口渲染進程
     * @param callback 接收 routeName 的回調
     */
    onMenuAction: (callback: (routeName: string) => void) => {
      // 移除舊監聽器防止重複
      ipcRenderer.removeAllListeners(IpcChannels.BALL_MENU_ACTION)
      ipcRenderer.on(IpcChannels.BALL_MENU_ACTION, (_event, routeName: string) => {
        callback(routeName)
      })
    }
  },

  // ─── Auth Token ────────────────────────────────────────────
  auth: {
    getToken:    () => ipcRenderer.invoke(IpcChannels.AUTH_GET_TOKEN),
    setToken:    (token: string) => ipcRenderer.invoke(IpcChannels.AUTH_SET_TOKEN, token),
    deleteToken: () => ipcRenderer.invoke(IpcChannels.AUTH_DELETE_TOKEN)
  },

  // ─── 通用事件監聽 ──────────────────────────────────────────
  /**
   * 監聽主進程推送事件
   * 允許的頻道列表（白名單，防止監聽任意頻道）
   */
  on: (channel: string, callback: (...args: unknown[]) => void) => {
    const ALLOWED_CHANNELS = [
      IpcChannels.PUSH_CONFIG_CHANGED,
      IpcChannels.PUSH_TRAY_CLICKED,
      IpcChannels.PUSH_WINDOW_MAXIMIZED
    ] as string[]

    if (ALLOWED_CHANNELS.includes(channel)) {
      ipcRenderer.on(channel, (_event, ...args) => callback(...args))
    }
  },

  /**
   * 取消監聽主進程推送事件
   */
  off: (channel: string, callback: (...args: unknown[]) => void) => {
    ipcRenderer.off(channel, callback as never)
  }
})
