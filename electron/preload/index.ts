/**
 * 主窗口預加載腳本，渲染進程 ↔ 主進程的唯一通信橋樑。
 * 用於：window.electronAPI.* 暴露給 src/ 渲染層使用。
 * 不暴露 ipcRenderer 本身，所有 channel 走白名單避免任意監聽/發送。
 *
 * 注意：IPC 頻道常量直接內聯在此文件中，不從 @shared/ipc-channels import，
 * 避免 Rollup 代碼分割產生 chunk 文件（Electron 沙盒無法解析 chunk 相對路徑）。
 */

import {contextBridge, ipcRenderer} from 'electron'

// ─── IPC 頻道常量（內聯，與 electron/shared/ipc-channels.ts 保持同步） ──
const IPC = {
    CONFIG_READ: 'config:read',
    CONFIG_WRITE: 'config:write',
    WINDOW_MINIMIZE: 'window:minimize',
    WINDOW_MAXIMIZE: 'window:maximize',
    WINDOW_CLOSE: 'window:close',
    WINDOW_SHOW: 'window:show',
    WINDOW_HIDE: 'window:hide',
    WINDOW_IS_MAXIMIZED: 'window:is-maximized',
    OPEN_CHILD_WINDOW: 'window:open-child',
    BALL_SHOW: 'floating-ball:show',
    BALL_HIDE: 'floating-ball:hide',
    BALL_START_DRAG: 'floating-ball:start-drag',
    BALL_STOP_DRAG: 'floating-ball:stop-drag',
    BALL_GET_POSITION: 'floating-ball:get-position',
    BALL_MENU_ACTION: 'floating-ball:menu-action',
    PUSH_CONFIG_CHANGED: 'push:config-changed',
    PUSH_TRAY_CLICKED: 'push:tray-clicked',
    PUSH_WINDOW_MAXIMIZED: 'push:window-maximized',
    LOG_WRITE: 'log:write',
    LOG_OPEN_FOLDER: 'log:open-folder',
    UPDATE_CHECK: 'update:check',
    UPDATE_DOWNLOAD: 'update:download',
    UPDATE_QUIT_AND_INSTALL: 'update:quit-and-install',
    PUSH_UPDATE_CHECKING: 'push:update-checking',
    PUSH_UPDATE_AVAILABLE: 'push:update-available',
    PUSH_UPDATE_NOT_AVAILABLE: 'push:update-not-available',
    PUSH_UPDATE_PROGRESS: 'push:update-progress',
    PUSH_UPDATE_DOWNLOADED: 'push:update-downloaded',
    PUSH_UPDATE_ERROR: 'push:update-error'
} as const

/**
 * 原始 callback → 包裝函數的映射表。
 * 用於解決 on/off 配對問題：on 註冊的是包裝函數（剝離 _event 參數），
 * off 時需要用同一個包裝函數引用才能正確移除監聽器。
 * 使用 WeakMap 避免阻止 callback 被垃圾回收。
 */
const listenerMap = new WeakMap<Function, (_event: Electron.IpcRendererEvent, ...args: unknown[]) => void>()

contextBridge.exposeInMainWorld('electronAPI', {
  config: {
    /** @returns Promise<AppConfig> */
    read: () => ipcRenderer.invoke(IPC.CONFIG_READ),

    /** @param config Partial<AppConfig> */
    write: (config: unknown) => ipcRenderer.invoke(IPC.CONFIG_WRITE, config)
  },

  window: {
      minimize: () => ipcRenderer.send(IPC.WINDOW_MINIMIZE),
      maximize: () => ipcRenderer.send(IPC.WINDOW_MAXIMIZE),
      close: () => ipcRenderer.send(IPC.WINDOW_CLOSE),
      show: () => ipcRenderer.send(IPC.WINDOW_SHOW),
      hide: () => ipcRenderer.send(IPC.WINDOW_HIDE),
      isMaximized: () => ipcRenderer.invoke(IPC.WINDOW_IS_MAXIMIZED),

    /**
     * 在新 Electron 子窗口打開系統 URL（openMode='electron-window' 用）。
     * @param url   系統訪問 URL
     * @param title 子窗口標題
     */
    openChild: (url: string, title: string) =>
        ipcRenderer.invoke(IPC.OPEN_CHILD_WINDOW, url, title)
  },

  floatingBall: {
      show: () => ipcRenderer.send(IPC.BALL_SHOW),
      hide: () => ipcRenderer.send(IPC.BALL_HIDE),
      startDrag: () => ipcRenderer.send(IPC.BALL_START_DRAG),
      stopDrag: () => ipcRenderer.send(IPC.BALL_STOP_DRAG),

    /**
     * 訂閱浮球菜單操作（浮球選單項 → 主窗口導航）。
     * 用於：主窗口 App.vue；先 removeAllListeners 防止重複註冊。
     * @param callback 接收 routeName
     */
    onMenuAction: (callback: (routeName: string) => void) => {
        ipcRenderer.removeAllListeners(IPC.BALL_MENU_ACTION)
        ipcRenderer.on(IPC.BALL_MENU_ACTION, (_event, routeName: string) => {
        callback(routeName)
      })
    }
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
    }) => ipcRenderer.send(IPC.LOG_WRITE, entry),

      openFolder: () => ipcRenderer.invoke(IPC.LOG_OPEN_FOLDER) as Promise<{
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
      check: () => ipcRenderer.invoke(IPC.UPDATE_CHECK),
      download: () => ipcRenderer.invoke(IPC.UPDATE_DOWNLOAD),
      quitAndInstall: () => ipcRenderer.invoke(IPC.UPDATE_QUIT_AND_INSTALL)
  },

  /**
   * 訂閱主進程推送事件。
   * 走白名單避免渲染端監聽任意 channel。
   *
   * 修復：使用 WeakMap 保存「原始 callback → 包裝函數」的映射，
   * off 時通過映射找到 on 時註冊的真正包裝函數來移除，解決內存泄漏問題。
   */
  on: (channel: string, callback: (...args: unknown[]) => void) => {
    const ALLOWED_CHANNELS = [
        IPC.PUSH_CONFIG_CHANGED,
        IPC.PUSH_TRAY_CLICKED,
        IPC.PUSH_WINDOW_MAXIMIZED,
      // 浮球/托盤右鍵菜單導航推送（主進程 webContents.send 到主窗口）
      'floating-ball:navigate',
      // UpdateManager 廣播的更新生命週期事件
        IPC.PUSH_UPDATE_CHECKING,
        IPC.PUSH_UPDATE_AVAILABLE,
        IPC.PUSH_UPDATE_NOT_AVAILABLE,
        IPC.PUSH_UPDATE_PROGRESS,
        IPC.PUSH_UPDATE_DOWNLOADED,
        IPC.PUSH_UPDATE_ERROR
    ] as string[]

    if (ALLOWED_CHANNELS.includes(channel)) {
      // 創建包裝函數，剝離 Electron 的 _event 參數
      const wrapper = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => callback(...args)
      // 保存映射：原始 callback → 包裝函數，off 時需要用包裝函數來移除
      listenerMap.set(callback, wrapper)
      ipcRenderer.on(channel, wrapper)
    }
  },

  /**
   * 取消訂閱主進程推送事件。
   * 通過 WeakMap 找到 on 時註冊的包裝函數，正確移除監聽器。
   */
  off: (channel: string, callback: (...args: unknown[]) => void) => {
    const wrapper = listenerMap.get(callback)
    if (wrapper) {
      ipcRenderer.off(channel, wrapper)
      listenerMap.delete(callback)
    }
  }
})
