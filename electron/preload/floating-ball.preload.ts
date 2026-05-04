/**
 * 浮球窗口預加載腳本，暴露的 API 比主窗口少。
 * 用於：浮球渲染進程；只需拖動、顯示主窗口、讀配置、彈右鍵菜單。
 *
 * 注意：IPC 頻道常量直接內聯，不從 shared 模塊 import（避免 chunk 拆分問題）。
 *       新增頻道時必須同步 electron/shared/ipc-channels.ts 與本檔的 IPC 對象。
 */

import {contextBridge, ipcRenderer} from 'electron'

// ─── IPC 頻道常量（內聯，僅保留浮球用到的頻道） ──
const IPC = {
    BALL_START_DRAG: 'floating-ball:start-drag',
    BALL_STOP_DRAG: 'floating-ball:stop-drag',
    BALL_SHOW_CONTEXT_MENU: 'floating-ball:show-context-menu',
    WINDOW_SHOW: 'window:show',
    CONFIG_READ: 'config:read'
} as const

contextBridge.exposeInMainWorld('electronAPI', {
  floatingBall: {
    /** mousedown 時呼叫，主進程接管位置更新 ~60fps */
    startDrag: () => ipcRenderer.send(IPC.BALL_START_DRAG),

    /** mouseup 時呼叫，觸發邊緣吸附動畫 */
    stopDrag: () => ipcRenderer.send(IPC.BALL_STOP_DRAG)
  },

  window: {
    /** 浮球左鍵點擊時呼叫，顯示主窗口並帶到前台 */
    show: () => ipcRenderer.send(IPC.WINDOW_SHOW)
  },

  config: {
    /** 浮球需要 floatingBall.quickMenu */
    read: () => ipcRenderer.invoke(IPC.CONFIG_READ)
  },

  /**
   * 請求主進程彈原生 context menu。
   * 用原生而非 HTML 是因為浮球窗口只有 60×60，會把菜單裁掉。
   * 主進程收到後自行讀 config.floatingBall.quickMenu，
   * 各 action.type 由主進程一站式處理（不需要再從浮球反饋路由名稱）。
   */
  showContextMenu: () => ipcRenderer.send(IPC.BALL_SHOW_CONTEXT_MENU)
})
