/**
 * 浮球窗口預加載腳本，暴露的 API 比主窗口少。
 * 用於：浮球渲染進程；只需拖動、顯示主窗口、讀配置、轉發菜單導航。
 */

import { contextBridge, ipcRenderer } from 'electron'
import { IpcChannels } from '../shared/ipc-channels'

contextBridge.exposeInMainWorld('electronAPI', {
  floatingBall: {
    /** mousedown 時呼叫，主進程接管位置更新 ~60fps */
    startDrag: () => ipcRenderer.send(IpcChannels.BALL_START_DRAG),

    /** mouseup 時呼叫，觸發邊緣吸附動畫 */
    stopDrag: () => ipcRenderer.send(IpcChannels.BALL_STOP_DRAG)
  },

  window: {
    /** 浮球左鍵點擊時呼叫，顯示主窗口並帶到前台 */
    show: () => ipcRenderer.send(IpcChannels.WINDOW_SHOW)
  },

  config: {
    /** 浮球需要 floatingBall.quickMenu */
    read: () => ipcRenderer.invoke(IpcChannels.CONFIG_READ)
  },

  /**
   * 請求主進程彈原生 context menu。
   * 用原生而非 HTML 是因為浮球窗口只有 60×60，會把菜單裁掉。
   */
  showContextMenu: () => ipcRenderer.send('floating-ball:show-context-menu'),

  /**
   * 執行快捷菜單動作。
   * navigate 類型走「先 show 主窗口 + 再 send routeName」兩步，
   * 由主進程中轉到主窗口的 'floating-ball:navigate' 監聽。
   */
  executeMenuAction: (actionType: string, payload?: string) => {
    switch (actionType) {
      case 'show-main-window':
        ipcRenderer.send(IpcChannels.WINDOW_SHOW)
        break

      case 'navigate':
        ipcRenderer.send(IpcChannels.WINDOW_SHOW)
        // 主進程收到後轉發給主窗口渲染進程
        ipcRenderer.send(IpcChannels.BALL_MENU_ACTION, payload)
        break

      case 'quit-app':
        ipcRenderer.send('app:quit')
        break
    }
  }
})
