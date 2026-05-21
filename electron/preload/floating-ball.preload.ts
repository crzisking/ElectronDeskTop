/**
 * 浮球窗口預加載腳本,暴露的 API 比主窗口少。
 *
 * 用於浮球渲染進程,只需:拖動、顯示主窗口、讀配置、彈右鍵菜單。
 *
 * ⚠️ channel 字串內聯而非 import @shared/ipc-channels 的原因:
 *   3 個 preload(本檔 + log-viewer + 主 preload)若都 import 共用模組,
 *   Rollup 會抽 chunks/xxx.js,但 webPreferences.sandbox: true 的 Electron preload
 *   無法解析 chunks/ 相對路徑 → preload 載入失敗。
 *
 *   折衷:小 preload(只用幾個 channel)維持內聯,主 preload 因 channel 數量多才走 import。
 *
 * 🔗 channel source of truth:electron/shared/ipc-channels/*.ts
 *   ── 新增 / 改名 channel 必須兩處同步:那邊 + 本檔。
 *   ── 同步漏掉的話會在運行期靜默無響應(IPC channel 字串對不上)。
 */

import {contextBridge, ipcRenderer} from 'electron'

const IPC = {
  BALL_START_DRAG: 'floating-ball:start-drag',
  BALL_STOP_DRAG: 'floating-ball:stop-drag',
  BALL_SHOW_CONTEXT_MENU: 'floating-ball:show-context-menu',
  WINDOW_SHOW: 'window:show',
  CONFIG_READ: 'config:read',
} as const

contextBridge.exposeInMainWorld('electronAPI', {
  floatingBall: {
    /** mousedown 時呼叫,主進程接管位置更新 ~60fps */
    startDrag: () => ipcRenderer.send(IPC.BALL_START_DRAG),

    /** mouseup 時呼叫,觸發邊緣吸附動畫 */
    stopDrag: () => ipcRenderer.send(IPC.BALL_STOP_DRAG),
  },

  window: {
    /** 浮球左鍵點擊時呼叫,顯示主窗口並帶到前台 */
    show: () => ipcRenderer.send(IPC.WINDOW_SHOW),
  },

  config: {
    /** 浮球需要讀 floatingBall.quickMenu */
    read: () => ipcRenderer.invoke(IPC.CONFIG_READ),
  },

  /**
   * 請求主進程彈原生 context menu。
   * 用原生而非 HTML 是因為浮球窗口只有 60×60,HTML 菜單會被裁切。
   * 主進程收到後自行讀 config.floatingBall.quickMenu,各 action.type 一站式處理。
   */
  showContextMenu: () => ipcRenderer.send(IPC.BALL_SHOW_CONTEXT_MENU),
})
