/**
 * window.electronAPI 型別聲明 — 渲染進程 ↔ 主進程的唯一橋。
 *
 * 各 feature 介面拆到 ./electron/<feature>.ts(docs/24 §6.4)。
 * 本檔只做組合 + 通用 IPC 訂閱 + 浮球右鍵菜單。
 *
 * 實際實作在 electron/preload/index.ts 透過 contextBridge 注入。
 * 渲染進程嚴禁直接用 require('electron') 或 window.require。
 */

import type {ConfigAPI} from './electron/config'
import type {WindowAPI} from './electron/window'
import type {FloatingBallAPI} from './electron/floating-ball'
import type {LogAPI} from './electron/log'
import type {UpdateAPI} from './electron/update'
import type {LogViewerAPI} from './electron/log-viewer'
import type {WorkCollectAPI} from './electron/work-collect'
import type {UserProfileAPI} from './electron/user-profile'
import type {AuthAPI} from './electron/auth'

// 確保此檔被視為模塊(避免全局聲明衝突)
export {}

declare global {
  interface Window {
    electronAPI: {
      config: ConfigAPI
      window: WindowAPI
      floatingBall: FloatingBallAPI
      log: LogAPI
      update: UpdateAPI
      logViewer: LogViewerAPI
      workCollect: WorkCollectAPI
      userProfile: UserProfileAPI
      auth: AuthAPI

      /**
       * 浮球右鍵原生菜單。
       * 請求主進程在游標位置彈出 native context menu;僅浮球窗口的 preload 提供。
       */
      showContextMenu: () => void

      // ─── 通用 IPC 事件 ─────────────────────────────────────
      /**
       * 監聽主進程推送事件。
       * @param channel  事件頻道(使用 IpcChannels 常量)
       * @param callback 事件回調
       */
      on: (channel: string, callback: (...args: unknown[]) => void) => void

      /**
       * 取消監聽主進程推送事件。
       * @param channel  事件頻道
       * @param callback 要移除的回調(必須是同一個函數引用)
       */
      off: (channel: string, callback: (...args: unknown[]) => void) => void
    }
  }
}
