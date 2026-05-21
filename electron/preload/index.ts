/**
 * 主窗口預加載腳本 — 渲染進程 ↔ 主進程的唯一通信橋樑。
 *
 * 設計原則:
 *  - 暴露範圍最小化:bridge 只暴露各 feature 必要 API,不暴露 ipcRenderer 本身
 *  - 推送事件走白名單(ALLOWED_CHANNELS),避免渲染端任意監聽 channel
 *  - bridge 拆檔(./bridges/*.bridge.ts):factory 模式,IPC channel 字串集中在本檔注入
 *
 * 為什麼 channel 字串內聯在本檔而不從 @shared/ipc-channels import:
 *  - 預加載腳本若 import 跨檔常數,Rollup 可能拆 chunk
 *  - Electron 沙盒對 chunk 相對路徑解析容易失敗
 *  - 字串集中在這裡跟 electron/shared/ipc-channels/* 手動同步,有 type 約束做兜底
 */

import {contextBridge, ipcRenderer} from 'electron'
import {createConfigBridge} from './bridges/config.bridge'
import {createWindowBridge} from './bridges/window.bridge'
import {createFloatingBallBridge} from './bridges/floating-ball.bridge'
import {createLogBridge} from './bridges/log.bridge'
import {createUpdateBridge} from './bridges/update.bridge'
import {createAuthBridge} from './bridges/auth.bridge'
import {createLogViewerBridge} from './bridges/log-viewer.bridge'
import {createWorkCollectBridge} from './bridges/work-collect.bridge'

// ─── IPC channel 字串(與 electron/shared/ipc-channels/* 同步)──────
const IPC = {
  // config
  CONFIG_READ: 'config:read',
  CONFIG_WRITE: 'config:write',
  // window
  WINDOW_MINIMIZE: 'window:minimize',
  WINDOW_MAXIMIZE: 'window:maximize',
  WINDOW_CLOSE: 'window:close',
  WINDOW_SHOW: 'window:show',
  WINDOW_HIDE: 'window:hide',
  WINDOW_IS_MAXIMIZED: 'window:is-maximized',
  OPEN_CHILD_WINDOW: 'window:open-child',
  WINDOW_OPEN_LOG_VIEWER: 'window:open-log-viewer',
  // floating-ball
  BALL_SHOW: 'floating-ball:show',
  BALL_HIDE: 'floating-ball:hide',
  BALL_START_DRAG: 'floating-ball:start-drag',
  BALL_STOP_DRAG: 'floating-ball:stop-drag',
  // log
  LOG_WRITE: 'log:write',
  LOG_OPEN_FOLDER: 'log:open-folder',
  LOG_VIEWER_UNLOCK: 'log-viewer:unlock',
  // update
  UPDATE_CHECK: 'update:check',
  UPDATE_DOWNLOAD: 'update:download',
  UPDATE_QUIT_AND_INSTALL: 'update:quit-and-install',
  // auth
  AUTH_GET_AD_ACCOUNT: 'auth:get-ad-account',
  AUTH_AD_LOGIN: 'auth:ad-login',
  // work-collect
  WORK_COLLECT_TOGGLE: 'work:toggle',
  WORK_COLLECT_LIST: 'work:list',
  WORK_COLLECT_RESULT: 'work:result',
} as const

// ─── 推送事件白名單(渲染端 on/off 用)──────────────────────────
const ALLOWED_PUSH_CHANNELS: readonly string[] = [
  'push:config-changed',
  'push:tray-clicked',
  'push:window-maximized',
  'floating-ball:navigate',
  // electron-updater 廣播的生命週期事件
  'push:update-checking',
  'push:update-available',
  'push:update-not-available',
  'push:update-progress',
  'push:update-downloaded',
  'push:update-error',
  // 工作採集:tick 推送 + 寫入完成通知
  'push:work-collect-tick',
  'push:work-record-new',
]

/**
 * 原始 callback → 包裝函數的映射表。
 * on 註冊的是包裝函數(剝離 _event 參數),off 時需要用同一個包裝函數引用才能正確移除。
 * WeakMap 避免阻止 callback 被 GC。
 */
const listenerMap = new WeakMap<
  Function,
  (_event: Electron.IpcRendererEvent, ...args: unknown[]) => void
>()

contextBridge.exposeInMainWorld('electronAPI', {
  config: createConfigBridge(ipcRenderer, IPC),
  window: createWindowBridge(ipcRenderer, IPC),
  floatingBall: createFloatingBallBridge(ipcRenderer, IPC),
  log: createLogBridge(ipcRenderer, IPC),
  update: createUpdateBridge(ipcRenderer, IPC),
  auth: createAuthBridge(ipcRenderer, IPC),
  logViewer: createLogViewerBridge(ipcRenderer, IPC),
  workCollect: createWorkCollectBridge(ipcRenderer, IPC),

  /**
   * 訂閱主進程推送事件,走白名單。
   * 重複 on 同一個 callback 會被 wrapper map 自動覆蓋,off 用同個 callback 引用即可解除。
   */
  on(channel: string, callback: (...args: unknown[]) => void) {
    if (!ALLOWED_PUSH_CHANNELS.includes(channel)) return
    const wrapper = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => callback(...args)
    listenerMap.set(callback, wrapper)
    ipcRenderer.on(channel, wrapper)
  },

  /** 取消訂閱(透過 listenerMap 找到 on 時註冊的包裝函數) */
  off(_channel: string, callback: (...args: unknown[]) => void) {
    const wrapper = listenerMap.get(callback)
    if (wrapper) {
      ipcRenderer.off(_channel, wrapper)
      listenerMap.delete(callback)
    }
  },
})
