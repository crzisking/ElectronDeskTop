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
    PUSH_CONFIG_CHANGED: 'push:config-changed',
    PUSH_TRAY_CLICKED: 'push:tray-clicked',
    PUSH_WINDOW_MAXIMIZED: 'push:window-maximized',
    PUSH_BALL_NAVIGATE: 'floating-ball:navigate',
    LOG_WRITE: 'log:write',
    LOG_OPEN_FOLDER: 'log:open-folder',
    UPDATE_CHECK: 'update:check',
    UPDATE_DOWNLOAD: 'update:download',
    UPDATE_QUIT_AND_INSTALL: 'update:quit-and-install',
    AUTH_GET_AD_ACCOUNT: 'auth:get-ad-account',
    AUTH_AD_LOGIN: 'auth:ad-login',
    PUSH_UPDATE_CHECKING: 'push:update-checking',
    PUSH_UPDATE_AVAILABLE: 'push:update-available',
    PUSH_UPDATE_NOT_AVAILABLE: 'push:update-not-available',
    PUSH_UPDATE_PROGRESS: 'push:update-progress',
    PUSH_UPDATE_DOWNLOADED: 'push:update-downloaded',
    PUSH_UPDATE_ERROR: 'push:update-error',
    LOG_VIEWER_UNLOCK: 'log-viewer:unlock',
    WINDOW_OPEN_LOG_VIEWER: 'window:open-log-viewer',
    WORK_COLLECT_SET_AUTH: 'work:set-auth',
    WORK_COLLECT_TOGGLE: 'work:toggle',
    WORK_COLLECT_LIST: 'work:list',
    PUSH_WORK_RECORD_NEW: 'push:work-record-new'
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
      stopDrag: () => ipcRenderer.send(IPC.BALL_STOP_DRAG)
      // 注意：浮球右鍵菜單的 navigate 由主進程 ipc-handlers/index.ts 統一處理
      // 並透過 PUSH_BALL_NAVIGATE 推送到主窗口的 electronAPI.on(...) 訂閱，
      // 不需要在 floatingBall 命名空間單獨暴露 onMenuAction 接口。
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
   * 認證相關。
   * getAdAccount() 取本機 Windows 帳號名(域機環境下即為 AD 帳號),
   * 用於 AD 自動登入流程。非 Windows 平台返回空字串。
   */
  auth: {
      getAdAccount: () => ipcRenderer.invoke(IPC.AUTH_GET_AD_ACCOUNT) as Promise<string>,
      adLogin: (account: string) =>
          ipcRenderer.invoke(IPC.AUTH_AD_LOGIN, account) as Promise<string>
  },

  /**
   * 日誌查看器(密碼保護)。
   *  - unlock(password):驗密碼,成功返回 true,本 session 內後續可開窗 / 查詢
   *  - openWindow():開啟日誌查看器子視窗(必須先 unlock 成功)
   *  查詢 API 在獨立的 log-viewer.preload.js 內暴露,主窗不需要
   */
  logViewer: {
      unlock: (password: string) =>
          ipcRenderer.invoke(IPC.LOG_VIEWER_UNLOCK, password) as Promise<boolean>,
      openWindow: () => ipcRenderer.send(IPC.WINDOW_OPEN_LOG_VIEWER)
  },

  /**
   * 工作自動採集。
   * 渲染端職責:
   *  - 登入成功後呼叫 setAuth(token, apiBaseUrl),把後端認證 + URL 推給主進程 scheduler
   *  - 內部功能頁切換 toggle → 走 toggle(enabled)
   *  - 流水線 UI 載入 → 走 list({since, until})
   * 採集邏輯主進程跑,渲染端不關心 setInterval 細節。
   */
  workCollect: {
      setAuth: (payload: {token: string | null; apiBaseUrl: string}) =>
          ipcRenderer.send(IPC.WORK_COLLECT_SET_AUTH, payload),
      toggle: (enabled: boolean) =>
          ipcRenderer.invoke(IPC.WORK_COLLECT_TOGGLE, enabled) as Promise<boolean>,
      list: (params: {since: number; until: number}) =>
          ipcRenderer.invoke(IPC.WORK_COLLECT_LIST, params)
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
        IPC.PUSH_BALL_NAVIGATE,
      // UpdateManager 廣播的更新生命週期事件
        IPC.PUSH_UPDATE_CHECKING,
        IPC.PUSH_UPDATE_AVAILABLE,
        IPC.PUSH_UPDATE_NOT_AVAILABLE,
        IPC.PUSH_UPDATE_PROGRESS,
        IPC.PUSH_UPDATE_DOWNLOADED,
        IPC.PUSH_UPDATE_ERROR,
      // 工作採集:scheduler 寫入新紀錄後通知渲染端刷新流水線
        IPC.PUSH_WORK_RECORD_NEW
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
