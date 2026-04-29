/**
 * 主窗口預加載腳本，渲染進程 ↔ 主進程的唯一通信橋樑。
 * 用於：window.electronAPI.* 暴露給 src/ 渲染層使用。
 * 不暴露 ipcRenderer 本身，所有 channel 走白名單避免任意監聽/發送。
 */

import { contextBridge, ipcRenderer } from 'electron'
import { IpcChannels } from '../shared/ipc-channels'

contextBridge.exposeInMainWorld('electronAPI', {
  config: {
    /** @returns Promise<AppConfig> */
    read: () => ipcRenderer.invoke(IpcChannels.CONFIG_READ),

    /** @param config Partial<AppConfig> */
    write: (config: unknown) => ipcRenderer.invoke(IpcChannels.CONFIG_WRITE, config)
  },

  window: {
    minimize: () => ipcRenderer.send(IpcChannels.WINDOW_MINIMIZE),
    maximize: () => ipcRenderer.send(IpcChannels.WINDOW_MAXIMIZE),
    close:    () => ipcRenderer.send(IpcChannels.WINDOW_CLOSE),
    show:     () => ipcRenderer.send(IpcChannels.WINDOW_SHOW),
    hide:     () => ipcRenderer.send(IpcChannels.WINDOW_HIDE),
    isMaximized: () => ipcRenderer.invoke(IpcChannels.WINDOW_IS_MAXIMIZED),

    /**
     * 在新 Electron 子窗口打開系統 URL（openMode='electron-window' 用）。
     * @param url   系統訪問 URL
     * @param title 子窗口標題
     */
    openChild: (url: string, title: string) =>
      ipcRenderer.invoke(IpcChannels.OPEN_CHILD_WINDOW, url, title)
  },

  floatingBall: {
    show:      () => ipcRenderer.send(IpcChannels.BALL_SHOW),
    hide:      () => ipcRenderer.send(IpcChannels.BALL_HIDE),
    startDrag: () => ipcRenderer.send(IpcChannels.BALL_START_DRAG),
    stopDrag:  () => ipcRenderer.send(IpcChannels.BALL_STOP_DRAG),

    /**
     * 訂閱浮球菜單操作（浮球選單項 → 主窗口導航）。
     * 用於：主窗口 App.vue；先 removeAllListeners 防止重複註冊。
     * @param callback 接收 routeName
     */
    onMenuAction: (callback: (routeName: string) => void) => {
      ipcRenderer.removeAllListeners(IpcChannels.BALL_MENU_ACTION)
      ipcRenderer.on(IpcChannels.BALL_MENU_ACTION, (_event, routeName: string) => {
        callback(routeName)
      })
    }
  },

  auth: {
    getToken:    () => ipcRenderer.invoke(IpcChannels.AUTH_GET_TOKEN),
    setToken:    (token: string) => ipcRenderer.invoke(IpcChannels.AUTH_SET_TOKEN, token),
    deleteToken: () => ipcRenderer.invoke(IpcChannels.AUTH_DELETE_TOKEN)
  },

  /**
   * 渲染端日誌寫到主進程文件 + 打開日誌資料夾。
   * 渲染端通常用 src/utils/logger.ts 封裝後呼叫，不直接用此 API。
   */
  log: {
    write: (entry: {
      level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'
      message: string
      module?: string
      args?: unknown[]
    }) => ipcRenderer.send(IpcChannels.LOG_WRITE, entry),

    openFolder: () => ipcRenderer.invoke(IpcChannels.LOG_OPEN_FOLDER) as Promise<{
      ok: boolean
      dir: string
    }>
  },

  /**
   * 自動更新主動指令；事件訂閱走 electronAPI.on('push:update-*', cb)。
   * @example
   *   await window.electronAPI.update.check()
   *   window.electronAPI.on('push:update-available', (info) => { ... })
   */
  update: {
    check:          () => ipcRenderer.invoke(IpcChannels.UPDATE_CHECK),
    download:       () => ipcRenderer.invoke(IpcChannels.UPDATE_DOWNLOAD),
    quitAndInstall: () => ipcRenderer.invoke(IpcChannels.UPDATE_QUIT_AND_INSTALL)
  },

  /**
   * 訂閱主進程推送事件。
   * 走白名單避免渲染端監聽任意 channel。
   */
  on: (channel: string, callback: (...args: unknown[]) => void) => {
    const ALLOWED_CHANNELS = [
      IpcChannels.PUSH_CONFIG_CHANGED,
      IpcChannels.PUSH_TRAY_CLICKED,
      IpcChannels.PUSH_WINDOW_MAXIMIZED,
      // 浮球/托盤右鍵菜單導航推送（主進程 webContents.send 到主窗口）
      'floating-ball:navigate',
      // UpdateManager 廣播的更新生命週期事件
      IpcChannels.PUSH_UPDATE_CHECKING,
      IpcChannels.PUSH_UPDATE_AVAILABLE,
      IpcChannels.PUSH_UPDATE_NOT_AVAILABLE,
      IpcChannels.PUSH_UPDATE_PROGRESS,
      IpcChannels.PUSH_UPDATE_DOWNLOADED,
      IpcChannels.PUSH_UPDATE_ERROR
    ] as string[]

    if (ALLOWED_CHANNELS.includes(channel)) {
      ipcRenderer.on(channel, (_event, ...args) => callback(...args))
    }
  },

  /** 取消訂閱主進程推送事件 */
  off: (channel: string, callback: (...args: unknown[]) => void) => {
    ipcRenderer.off(channel, callback as never)
  }
})
