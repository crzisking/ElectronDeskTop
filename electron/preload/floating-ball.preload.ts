/**
 * 浮球窗口預加載腳本
 *
 * 浮球是獨立的 BrowserWindow，有自己的預加載腳本。
 * 暴露的 API 比主窗口更少（浮球不需要 auth、config 寫入等功能）。
 *
 * 主要職責：
 *  - 拖動控制（startDrag / stopDrag）
 *  - 顯示主窗口
 *  - 讀取配置（獲取 quickMenu 菜單項）
 *  - 通知主窗口進行路由導航（通過主進程中轉）
 */

import { contextBridge, ipcRenderer } from 'electron'
import { IpcChannels } from '../shared/ipc-channels'

contextBridge.exposeInMainWorld('electronAPI', {
  // ─── 浮球自身控制 ──────────────────────────────────────────
  floatingBall: {
    /**
     * 開始拖動（在 mousedown 時調用）
     * 主進程接管位置更新，以 60fps 輪詢游標位置
     */
    startDrag: () => ipcRenderer.send(IpcChannels.BALL_START_DRAG),

    /**
     * 停止拖動（在 mouseup 時調用）
     * 觸發邊緣吸附動畫
     */
    stopDrag: () => ipcRenderer.send(IpcChannels.BALL_STOP_DRAG)
  },

  // ─── 主窗口控制 ────────────────────────────────────────────
  window: {
    /** 顯示主窗口並帶到前台（浮球左鍵點擊時調用） */
    show: () => ipcRenderer.send(IpcChannels.WINDOW_SHOW)
  },

  // ─── 配置讀取 ──────────────────────────────────────────────
  config: {
    /** 讀取應用配置（浮球需要 floatingBall.quickMenu 菜單項） */
    read: () => ipcRenderer.invoke(IpcChannels.CONFIG_READ)
  },

  // ─── 原生右鍵菜單 ─────────────────────────────────────────
  /**
   * 請求主進程彈出原生 context menu（不受浮球窗口 60×60 尺寸限制）
   * 主進程根據 config.floatingBall.quickMenu 構建 Menu 並在光標位置顯示
   */
  showContextMenu: () => ipcRenderer.send('floating-ball:show-context-menu'),

  // ─── 菜單操作 ──────────────────────────────────────────────
  /**
   * 執行快捷菜單操作
   * 根據 action.type 決定行為：
   *  - show-main-window → 顯示主窗口
   *  - navigate         → 顯示主窗口 + 導航到指定路由
   *  - quit-app         → 退出應用
   */
  executeMenuAction: (actionType: string, payload?: string) => {
    switch (actionType) {
      case 'show-main-window':
        ipcRenderer.send(IpcChannels.WINDOW_SHOW)
        break

      case 'navigate':
        // 先顯示主窗口，再通知主窗口渲染進程導航
        ipcRenderer.send(IpcChannels.WINDOW_SHOW)
        // 通知主進程，主進程再轉發給主窗口渲染進程
        ipcRenderer.send(IpcChannels.BALL_MENU_ACTION, payload)
        break

      case 'quit-app':
        // 通過主進程退出整個應用
        ipcRenderer.send('app:quit')
        break
    }
  }
})
