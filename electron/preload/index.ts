/**
 * 主窗口預加載腳本 — 渲染進程 ↔ 主進程的唯一通信橋樑。
 *
 * 設計原則:
 *  - 暴露範圍最小化:bridge 只暴露各 feature 必要 API,不暴露 ipcRenderer 本身
 *  - 推送事件走白名單(ALLOWED_PUSH_CHANNELS),避免渲染端任意監聽 channel
 *  - bridge 拆檔(./bridges/*.bridge.ts):factory 模式,IPC channel 由本檔注入
 *
 * channel 字串的 source of truth:
 *   electron/shared/ipc-channels/*.ts → 經 @shared/ipc-channels barrel re-export
 *   本檔 import IpcChannels 後直接使用,**不再內聯字串**。
 *
 * 為什麼這樣安全(以前版本曾擔心 Rollup 拆 chunk 導致沙盒解析失敗):
 *   IpcChannels 是純 const 物件,Rollup tree-shake 後會把使用到的字串 inline,
 *   shared 模組不會留下獨立 chunk;electron-vite 的 preload build 已預設啟用
 *   單一 chunk 輸出。一旦未來改動引入了 chunk,build 階段就能立刻察覺。
 */

import {contextBridge, ipcRenderer} from 'electron'
import {IpcChannels} from '@shared/ipc-channels'
import {createConfigBridge} from './bridges/config.bridge'
import {createWindowBridge} from './bridges/window.bridge'
import {createFloatingBallBridge} from './bridges/floating-ball.bridge'
import {createLogBridge} from './bridges/log.bridge'
import {createUpdateBridge} from './bridges/update.bridge'
import {createAuthBridge} from './bridges/auth.bridge'
import {createLogViewerBridge} from './bridges/log-viewer.bridge'
import {createWorkCollectBridge} from './bridges/work-collect.bridge'

// ── 推送事件白名單(渲染端 on/off 用)─────────────────────────────
// 字串直接從 IpcChannels 取,避免兩份手動同步。
const ALLOWED_PUSH_CHANNELS: readonly string[] = [
  IpcChannels.PUSH_CONFIG_CHANGED,
  IpcChannels.PUSH_TRAY_CLICKED,
  IpcChannels.PUSH_WINDOW_MAXIMIZED,
  IpcChannels.PUSH_BALL_NAVIGATE,
  // electron-updater 廣播的生命週期事件
  IpcChannels.PUSH_UPDATE_CHECKING,
  IpcChannels.PUSH_UPDATE_AVAILABLE,
  IpcChannels.PUSH_UPDATE_NOT_AVAILABLE,
  IpcChannels.PUSH_UPDATE_PROGRESS,
  IpcChannels.PUSH_UPDATE_DOWNLOADED,
  IpcChannels.PUSH_UPDATE_ERROR,
  // 工作採集:tick 推送 + 寫入完成通知
  IpcChannels.PUSH_WORK_COLLECT_TICK,
  IpcChannels.PUSH_WORK_RECORD_NEW,
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
  config: createConfigBridge(ipcRenderer, IpcChannels),
  window: createWindowBridge(ipcRenderer, IpcChannels),
  floatingBall: createFloatingBallBridge(ipcRenderer, IpcChannels),
  log: createLogBridge(ipcRenderer, IpcChannels),
  update: createUpdateBridge(ipcRenderer, IpcChannels),
  auth: createAuthBridge(ipcRenderer, IpcChannels),
  logViewer: createLogViewerBridge(ipcRenderer, IpcChannels),
  workCollect: createWorkCollectBridge(ipcRenderer, IpcChannels),

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
  off(channel: string, callback: (...args: unknown[]) => void) {
    const wrapper = listenerMap.get(callback)
    if (wrapper) {
      ipcRenderer.off(channel, wrapper)
      listenerMap.delete(callback)
    }
  },
})
