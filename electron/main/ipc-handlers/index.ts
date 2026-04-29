/**
 * ============================================================
 * IPC Handler 注冊入口文件
 * 文件路徑：electron/main/ipc-handlers/index.ts
 * ============================================================
 *
 * 【這個文件的職責】
 * 統一注冊所有 IPC（進程間通信）頻道的處理器（Handler）。
 * 將分散在各模塊的 Handler 注冊邏輯整合到一個入口，
 * 讓主進程入口（electron/main/index.ts）保持簡潔，只需調用
 * registerAllHandlers() 這一個函數即可。
 *
 * ─────────────────────────────────────────────────────────────
 *
 * 【ipcMain.on 和 ipcMain.handle 的區別】
 *
 * 1. ipcMain.on(channel, handler)
 *    對應渲染進程：ipcRenderer.send(channel, ...args)
 *    特點：
 *      - 單向通信：主進程接收消息，但無法返回值給渲染進程
 *      - 「發了就忘」：渲染進程不等待主進程的回應
 *      - 適合：不需要返回值的操作（如：最小化窗口、開始拖動等）
 *    例子：
 *      // 渲染進程（preload）
 *      ipcRenderer.send('window:minimize')   // 發出，不等待
 *      // 主進程
 *      ipcMain.on('window:minimize', () => { mainWindow.minimize() })
 *
 * 2. ipcMain.handle(channel, handler)
 *    對應渲染進程：await ipcRenderer.invoke(channel, ...args)
 *    特點：
 *      - 雙向通信：主進程處理後返回值給渲染進程
 *      - handler 可以是 async 函數，支持異步操作
 *      - 渲染進程使用 await 等待結果
 *      - 適合：需要返回數據的操作（如：讀取配置、查詢窗口狀態等）
 *    例子：
 *      // 渲染進程（preload）
 *      const config = await ipcRenderer.invoke('config:read')   // 等待結果
 *      // 主進程
 *      ipcMain.handle('config:read', async () => {
 *        return configManager.getConfig()  // 返回值會傳給渲染進程
 *      })
 *
 * 選擇原則：
 *   - 需要返回值 → 用 handle / invoke
 *   - 不需要返回值 → 用 on / send
 *
 * ─────────────────────────────────────────────────────────────
 *
 * 【完整 IPC 調用鏈（以讀取配置為例）】
 *
 *  Step 1：Vue 組件調用 API
 *    // src/views/Settings.vue
 *    const config = await window.electronAPI.config.read()
 *
 *  Step 2：preload 腳本橋接
 *    // electron/preload/index.ts（或 main.preload.ts）
 *    contextBridge.exposeInMainWorld('electronAPI', {
 *      config: {
 *        read: () => ipcRenderer.invoke(IpcChannels.CONFIG_READ)
 *        //           ↑ 發送 'config:read' 頻道的請求給主進程
 *      }
 *    })
 *
 *  Step 3：主進程 Handler 接收並處理
 *    // electron/main/ipc-handlers/config.handlers.ts
 *    ipcMain.handle(IpcChannels.CONFIG_READ, () => {
 *      return configManager.getConfig()  // 返回配置對象
 *    })
 *
 *  Step 4：結果沿原路返回
 *    ipcMain.handle 的返回值 → ipcRenderer.invoke 的 Promise resolve
 *    → preload 的函數返回 → window.electronAPI.config.read() 返回
 *    → Vue 組件的 await 得到結果
 *
 * ─────────────────────────────────────────────────────────────
 *
 * 【為什麼 Handler 必須在 app.whenReady() 之後注冊？】
 * Electron 規定：ipcMain.handle/on 必須在 app ready 之後才能正確工作。
 * 而 registerAllHandlers() 在 electron/main/index.ts 的 whenReady 回調中調用，
 * 符合這個要求。
 *
 * 【為什麼 Handler 要在 BrowserWindow 創建之後注冊？】
 * 部分 Handler（如窗口控制）需要 windowManager 中已有窗口實例，
 * 如果先注冊 Handler 後創建窗口，Handler 閉包中的 windowManager 雖然存在，
 * 但其內部的 mainWindow 為 undefined，調用時會報錯。
 *
 * 注意：所有 Handler 必須在 app.whenReady() 之後、
 * BrowserWindow 創建之前注冊，否則可能錯過早期請求。
 */

// ─── Import 說明 ────────────────────────────────────────────────────────────

/**
 * `app`：Electron 應用對象，這裡用於 app.quit() 退出應用。
 *         來自：electron（Node.js 的 electron 包）
 *
 * `ipcMain`：主進程的 IPC 對象，用於注冊 Handler（on 和 handle）。
 *             來自：electron（Node.js 的 electron 包）
 *
 * `Menu`：Electron 的原生菜單類，用於構建和彈出操作系統級別的右鍵菜單。
 *          來自：electron（Node.js 的 electron 包）
 */
import { app, ipcMain, Menu } from 'electron'

/**
 * `IpcChannels`：所有 IPC 頻道名稱的常量集合。
 *                來自：../../shared/ipc-channels（electron/shared/ipc-channels.ts）
 *                使用常量而非字符串字面量，防止拼寫錯誤導致的靜默失敗。
 */
import { IpcChannels } from '../../shared/ipc-channels'

/**
 * `registerWindowHandlers`：注冊窗口相關的 IPC Handler 的函數。
 *                            來自：./window.handlers（electron/main/ipc-handlers/window.handlers.ts）
 *                            處理：WINDOW_MINIMIZE、WINDOW_MAXIMIZE、WINDOW_CLOSE、
 *                                  WINDOW_SHOW、WINDOW_HIDE、WINDOW_IS_MAXIMIZED 等
 */
import { registerWindowHandlers } from './window.handlers'

/**
 * `registerAuthHandlers`：注冊身份認證（Token 存取）相關的 IPC Handler 的函數。
 *                          來自：./auth.handlers（electron/main/ipc-handlers/auth.handlers.ts）
 *                          處理：AUTH_GET_TOKEN、AUTH_SET_TOKEN、AUTH_DELETE_TOKEN
 */
import { registerAuthHandlers } from './auth.handlers'

/**
 * `registerConfigHandlers`：注冊配置文件讀寫相關的 IPC Handler 的函數。
 *                            來自：./config.handlers（electron/main/ipc-handlers/config.handlers.ts）
 *                            處理：CONFIG_READ、CONFIG_WRITE
 */
import { registerConfigHandlers } from './config.handlers'

/**
 * `registerUpdateHandlers`：注冊自動更新相關的 IPC Handler。
 * 來自：./update.handlers（electron/main/ipc-handlers/update.handlers.ts）
 * 處理：UPDATE_CHECK、UPDATE_DOWNLOAD、UPDATE_QUIT_AND_INSTALL
 */
import { registerUpdateHandlers } from './update.handlers'

/**
 * `registerLogHandlers`：注冊日誌相關的 IPC Handler。
 * 來自：./log.handlers（electron/main/ipc-handlers/log.handlers.ts）
 * 處理：LOG_WRITE（渲染端日誌落地）、LOG_OPEN_FOLDER（打開日誌目錄）
 */
import { registerLogHandlers } from './log.handlers'

/**
 * `logger`：自定義日誌工具。
 *            來自：../utils/logger（electron/main/utils/logger.ts）
 */
import { logger } from '../utils/logger'

/**
 * 以下三個是 TypeScript 類型導入（import type），只在編譯時使用，
 * 不會被打包進最終的 JS 代碼，僅用於類型檢查和 IDE 智能提示。
 *
 * `WindowManager`：窗口管理器的類類型。
 *                   來自：../window-manager（electron/main/window-manager.ts）
 *
 * `ConfigManager`：配置管理器的類類型。
 *                   來自：../config-manager（electron/main/config-manager.ts）
 *
 * `FloatingBallManager`：浮球管理器的類類型。
 *                         來自：../floating-ball（electron/main/floating-ball.ts）
 */
import type { WindowManager } from '../window-manager'
import type { ConfigManager } from '../config-manager'
import type { FloatingBallManager } from '../floating-ball'
import type { UpdateManager } from '../update-manager'

/**
 * registerAllHandlers()：注冊所有 IPC Handler 的入口函數。
 *
 * 【調用位置】：electron/main/index.ts 的 app.whenReady() 回調中，
 *               在窗口創建後（Step 4）調用。
 *
 * 【參數說明】：
 * @param windowManager    窗口管理器實例，用於窗口和浮球的顯示/隱藏操作。
 *                          來自 main/index.ts 中的 `let windowManager`。
 * @param configManager    配置管理器實例，用於讀取浮球快捷菜單配置。
 *                          來自 main/index.ts 中的 `let configManager`。
 * @param floatingBallMgr  浮球管理器實例，用於控制拖動行為。
 *                          來自 main/index.ts 中的 `let floatingBallMgr`。
 *
 * 【為什麼接受這三個參數而不是在函數內部創建？】
 * 這三個管理器是應用全局共享的單例，在 main/index.ts 中創建並管理生命週期。
 * 通過參數傳入（依賴注入），使 Handler 函數可以操作這些已初始化的實例，
 * 同時避免循環引用和重複創建實例的問題。
 */
export function registerAllHandlers(
  windowManager: WindowManager,
  configManager: ConfigManager,
  floatingBallMgr: FloatingBallManager,
  updateMgr: UpdateManager
): void {

  // ─── 各模塊的 Handler（委託給子模塊注冊） ───────────────────────────────
  /**
   * 窗口控制 Handler（WINDOW_MINIMIZE、WINDOW_MAXIMIZE 等）
   * 定義位置：electron/main/ipc-handlers/window.handlers.ts
   * 觸發來源：主窗口的自定義標題欄 Vue 組件
   */
  registerWindowHandlers(windowManager)

  /**
   * 身份認證 Handler（AUTH_GET_TOKEN、AUTH_SET_TOKEN、AUTH_DELETE_TOKEN）
   * 定義位置：electron/main/ipc-handlers/auth.handlers.ts
   * 觸發來源：主窗口登錄/登出相關 Vue 組件
   */
  registerAuthHandlers()

  /**
   * 配置讀寫 Handler（CONFIG_READ、CONFIG_WRITE）
   * 定義位置：electron/main/ipc-handlers/config.handlers.ts
   * 觸發來源：主窗口設置頁面、初始化時讀取配置
   */
  registerConfigHandlers(configManager)

  /**
   * 自動更新 Handler（UPDATE_CHECK、UPDATE_DOWNLOAD、UPDATE_QUIT_AND_INSTALL）
   * 定義位置：electron/main/ipc-handlers/update.handlers.ts
   * 觸發來源：渲染層手動檢查更新、用戶確認重啟安裝
   */
  registerUpdateHandlers(updateMgr)

  /**
   * 日誌 Handler（LOG_WRITE、LOG_OPEN_FOLDER）
   * 定義位置：electron/main/ipc-handlers/log.handlers.ts
   * 觸發來源：渲染端 src/utils/logger.ts、設定彈窗的「打開日誌資料夾」按鈕
   */
  registerLogHandlers()

  // ─── 浮球 IPC Handler（邏輯簡單，直接在此注冊） ─────────────────────────

  /**
   * BALL_START_DRAG：開始拖動浮球。
   *
   * 使用 ipcMain.on（單向，無返回值）：
   *   因為開始拖動是一個「觸發即忘」的動作，不需要等待回應。
   *
   * 觸發位置（完整調用鏈）：
   *   1. 用戶在浮球上按下鼠標（浮球渲染進程監聽 mousedown 事件）
   *   2. 浮球渲染進程調用 window.floatingBallAPI.startDrag()
   *   3. preload 腳本（electron/preload/floating-ball.preload.ts）
   *      執行 ipcRenderer.send(IpcChannels.BALL_START_DRAG)
   *   4. 本 Handler 被觸發 → floatingBallMgr.startDrag()
   *   5. floatingBallMgr 啟動 setInterval，每 16ms 讀取鼠標位置並移動浮球窗口
   */
  ipcMain.on(IpcChannels.BALL_START_DRAG, () => {
    floatingBallMgr.startDrag()
    logger.debug('浮球開始拖動', 'IPC:ball')
  })

  /**
   * BALL_STOP_DRAG：停止拖動浮球，觸發邊緣吸附動畫。
   *
   * 使用 ipcMain.on（單向，無返回值）：
   *   停止拖動也是「觸發即忘」，主進程自行處理後續的吸附動畫。
   *
   * 觸發位置（完整調用鏈）：
   *   1. 用戶鬆開鼠標（浮球渲染進程監聽 mouseup 事件）
   *   2. 浮球渲染進程調用 window.floatingBallAPI.stopDrag()
   *   3. preload 腳本執行 ipcRenderer.send(IpcChannels.BALL_STOP_DRAG)
   *   4. 本 Handler 被觸發 → floatingBallMgr.stopDrag()
   *   5. floatingBallMgr 清除 setInterval，計算最近邊緣，執行吸附動畫
   */
  ipcMain.on(IpcChannels.BALL_STOP_DRAG, () => {
    floatingBallMgr.stopDrag()
    logger.debug('浮球停止拖動', 'IPC:ball')
  })

  /**
   * BALL_SHOW：顯示浮球窗口。
   *
   * 使用 ipcMain.on（單向，無返回值）
   *
   * 觸發位置：
   *   主窗口關閉（隱藏）時，需要讓浮球重新出現在桌面上。
   *   Vue 組件調用 window.electronAPI.ball.show()
   *   → preload 腳本發送 BALL_SHOW
   *   → 本 Handler 調用 windowManager.showFloatingBall()
   */
  ipcMain.on(IpcChannels.BALL_SHOW, () => {
    windowManager.showFloatingBall()
  })

  /**
   * BALL_HIDE：隱藏浮球窗口。
   *
   * 使用 ipcMain.on（單向，無返回值）
   *
   * 觸發位置：
   *   主窗口打開（顯示）時，通常需要隱藏浮球避免遮擋。
   *   Vue 組件調用 window.electronAPI.ball.hide()
   *   → preload 腳本發送 BALL_HIDE
   *   → 本 Handler 調用 windowManager.hideFloatingBall()
   */
  ipcMain.on(IpcChannels.BALL_HIDE, () => {
    windowManager.hideFloatingBall()
  })

  /**
   * BALL_GET_POSITION：獲取浮球當前在屏幕上的位置座標。
   *
   * 使用 ipcMain.handle（雙向，有返回值）：
   *   浮球渲染進程需要知道自己的位置（例如用於顯示菜單的定位計算），
   *   必須等待主進程返回實際座標。
   *
   * 觸發位置（完整調用鏈）：
   *   Vue 組件（浮球）調用 window.floatingBallAPI.getPosition()
   *   → preload 腳本執行 await ipcRenderer.invoke(IpcChannels.BALL_GET_POSITION)
   *   → 本 Handler 被觸發
   *   → 返回 windowManager.getFloatingBallPosition()（返回 { x: number, y: number }）
   *   → await 得到結果，Vue 組件拿到浮球座標
   */
  ipcMain.handle(IpcChannels.BALL_GET_POSITION, () => {
    return windowManager.getFloatingBallPosition()
  })

  // ─── 子窗口（electron-window 模式）──────────────────────────────────────
  /**
   * OPEN_CHILD_WINDOW：在新 Electron 窗口中打開 URL。
   *
   * 觸發位置：
   *   統一平台頁面，用戶點擊 openMode 為 'electron-window' 的系統卡片
   *   → window.electronAPI.window.openChild(url, title)
   *   → preload: ipcRenderer.invoke(IpcChannels.OPEN_CHILD_WINDOW, url, title)
   *   → 本 Handler 調用 windowManager.openChildWindow()
   */
  ipcMain.handle(IpcChannels.OPEN_CHILD_WINDOW, (_event, url: string, title: string) => {
    windowManager.openChildWindow(url, title)
    logger.info(`打開子窗口: ${title}`, 'IPC:window')
  })

  // ─── 應用退出 ──────────────────────────────────────────────────────────
  /**
   * 'app:quit'：觸發應用完全退出。
   *
   * 【注意】這裡使用了字符串字面量 'app:quit' 而非 IpcChannels 常量，
   * 這是因為該頻道未在 ipc-channels.ts 中定義。
   * 理想情況下應加入 IpcChannels，但現有代碼如此，故保留。
   *
   * 觸發位置：
   *   浮球渲染進程的右鍵菜單「退出應用」選項被點擊時觸發。
   *   浮球 preload 腳本的 executeMenuAction('quit-app')
   *   → ipcRenderer.send('app:quit')
   *   → 本 Handler 調用 app.quit()
   *
   * app.quit() 會觸發：
   *   1. 'before-quit' 事件（在 main/index.ts 中監聽，用於清理資源）
   *   2. 各窗口的 'close' 事件
   *   3. 'will-quit' 事件
   *   4. 最終退出進程
   *
   * 使用 ipcMain.on（單向，無返回值）：應用退出後進程已終止，無需返回值。
   */
  ipcMain.on('app:quit', () => {
    logger.info('收到退出指令，應用正在退出...', 'IPC:app')
    app.quit()
  })

  // ─── 浮球菜單動作轉發（浮球渲染進程 → 主進程 → 主窗口渲染進程） ────────────
  /**
   * BALL_MENU_ACTION：浮球菜單項點擊事件的轉發處理器。
   *
   * 【為什麼需要「轉發」？】
   * 浮球窗口和主窗口是兩個不同的 BrowserWindow（兩個獨立的渲染進程）。
   * 渲染進程之間不能直接通信，必須通過主進程中轉：
   *   浮球渲染進程 → ipcRenderer.send → 主進程 → mainWindow.webContents.send → 主窗口渲染進程
   *
   * 觸發位置（完整調用鏈）：
   *   1. 用戶點擊浮球的快捷菜單項（如「去主頁」）
   *   2. 浮球渲染進程調用 window.floatingBallAPI.executeMenuAction('navigate', 'home')
   *   3. floating-ball.preload.ts 執行：
   *      ipcRenderer.send(IpcChannels.BALL_MENU_ACTION, 'navigate', 'home')
   *   4. 本 Handler 被觸發，type='navigate', payload='home'
   *   5. 主進程調用 windowManager.showMainWindow()（先顯示主窗口）
   *   6. 主進程調用 mainWin.webContents.send('floating-ball:navigate', 'home')
   *      （向主窗口渲染進程發送路由跳轉指令）
   *   7. 主窗口的 Vue Router 守衛監聽此事件，執行 router.push('/home')
   *
   * 參數說明：
   *   _event：IPC 事件對象（此處不需要，用 _ 前綴表示「已知但不使用」）
   *   type：動作類型字符串，例如 'navigate'、'quit-app' 等
   *   payload：可選的附加數據，例如路由名稱 'home'、'settings' 等
   *
   * 使用 ipcMain.on（單向）：菜單動作不需要返回值。
   */
  ipcMain.on(IpcChannels.BALL_MENU_ACTION, (_event, type: string, payload?: string) => {
    logger.debug(`浮球菜單動作: ${type}, payload: ${payload ?? ''}`, 'IPC:ball')

    /**
     * getMainWindow()：獲取主窗口的 BrowserWindow 實例。
     * 如果主窗口未創建或已被銷毀（destroyed），則跳過後續操作。
     * isDestroyed()：Electron 的 BrowserWindow 方法，返回窗口是否已被銷毀。
     */
    const mainWin = windowManager.getMainWindow()
    if (!mainWin || mainWin.isDestroyed()) return

    // 所有菜單動作都先顯示主窗口（帶到前台）
    windowManager.showMainWindow()

    if (type === 'navigate' && payload) {
      /**
       * webContents.send()：主進程主動向指定渲染進程推送消息。
       * 這裡向主窗口的渲染進程發送路由跳轉指令。
       *
       * 主窗口 Vue 應用（App.vue 或 router.ts）通過：
       *   window.electronAPI.on('floating-ball:navigate', (routeName) => {
       *     router.push(routeName)
       *   })
       * 來接收並執行路由跳轉。
       */
      mainWin.webContents.send('floating-ball:navigate', payload)
    }
  })

  // ─── 浮球右鍵原生菜單 ──────────────────────────────────────────────────
  /**
   * 'floating-ball:show-context-menu'：彈出浮球的原生右鍵菜單。
   *
   * 【為什麼用原生菜單而不是 Vue 實現的自定義菜單？】
   * 浮球窗口只有 60×60 像素（小球大小），並且通常設置了 overflow: hidden。
   * 如果在浮球窗口內用 Vue 組件實現下拉菜單，菜單內容會被窗口邊界裁剪，
   * 只能顯示 60px 寬的內容，視覺上不完整。
   *
   * 解決方案：使用 Electron 的 Menu.buildFromTemplate() + menu.popup()，
   * 在操作系統層面彈出原生右鍵菜單（不屬於任何窗口，不受窗口尺寸限制）。
   *
   * 觸發位置（完整調用鏈）：
   *   1. 用戶右鍵點擊浮球（contextmenu 事件）
   *   2. 浮球渲染進程調用 window.floatingBallAPI.showContextMenu()
   *   3. preload 腳本執行 ipcRenderer.send('floating-ball:show-context-menu')
   *   4. 本 Handler 被觸發
   *   5. 從 configManager 讀取菜單項配置（啟用的菜單項）
   *   6. 動態構建 Menu 模板（根據 action.type 綁定點擊回調）
   *   7. Menu.buildFromTemplate() 創建原生菜單
   *   8. menu.popup() 在浮球窗口的鼠標位置彈出原生菜單
   *
   * 參數說明：
   *   event：IPC 事件對象，event.sender 是發送消息的浮球窗口的 webContents。
   *           此處用於標識是哪個窗口發來的請求（雖然本例未直接使用 event）。
   *
   * 使用 ipcMain.on（單向）：彈出菜單後不需要返回值。
   */
  ipcMain.on('floating-ball:show-context-menu', (event) => {
    /**
     * configManager.getConfig()：獲取當前應用配置。
     * config.floatingBall.quickMenu：浮球快捷菜單的項目數組。
     * .filter((item) => item.enabled)：過濾掉被用戶禁用的菜單項。
     */
    const config = configManager.getConfig()
    const menuItems = config.floatingBall.quickMenu.filter((item) => item.enabled)

    /**
     * 動態構建原生菜單模板（Electron MenuItemConstructorOptions[]）。
     *
     * 每個 menuItem 可以是：
     *   - 分隔線（item.separator === true）：顯示一條水平線
     *   - 普通菜單項：有 label 標籤和 click 點擊回調
     *
     * click 回調根據 item.action.type 執行不同邏輯：
     *   - 'show-main-window'：調用 windowManager.showMainWindow()
     *   - 'navigate'：顯示主窗口並發送路由跳轉指令到主窗口渲染進程
     *   - 'quit-app'：調用 app.quit() 退出應用
     *   - 'open-url'：調用 shell.openExternal() 在默認瀏覽器打開鏈接
     */
    const template = menuItems.map((item) => {
      // 分隔線
      if (item.separator) return { type: 'separator' as const }

      return {
        label: item.label,
        click: () => {
          const action = item.action
          switch (action.type) {
            case 'show-main-window':
              // 點擊「打開主窗口」：顯示並聚焦主窗口
              windowManager.showMainWindow()
              break

            case 'navigate': {
              // 點擊「去某個頁面」：先顯示主窗口，再發送路由跳轉消息
              windowManager.showMainWindow()
              const mainWin = windowManager.getMainWindow()
              if (mainWin && !mainWin.isDestroyed()) {
                /**
                 * 向主窗口渲染進程發送路由跳轉指令。
                 * 主窗口 Vue 應用監聽此消息並執行 router.push(action.routeName)。
                 */
                mainWin.webContents.send('floating-ball:navigate', action.routeName)
              }
              break
            }

            case 'quit-app':
              // 點擊「退出應用」：調用 app.quit()，觸發完整的退出流程
              app.quit()
              break

            case 'open-url':
              /**
               * shell.openExternal()：用操作系統的默認程序打開 URL。
               * 例如：URL 是 https:// 開頭，就用默認瀏覽器打開；
               *       URL 是 mailto: 開頭，就用默認郵件客戶端打開。
               * 使用 require() 而非頂部 import，是因為 shell 模塊較少用到，
               * 延遲加載可以略微優化啟動時間（非強制）。
               */
              require('electron').shell.openExternal(action.url)
              break
          }
        }
      }
    })

    /**
     * Menu.buildFromTemplate(template)：
     *   根據上面構建的模板數組，創建一個原生 Menu 對象。
     *
     * menu.popup({ window: ballWin ?? undefined })：
     *   在指定窗口的鼠標當前位置彈出原生右鍵菜單。
     *   { window: ballWin }：告訴 Electron 這個菜單屬於浮球窗口，
     *   菜單會出現在浮球窗口附近（鼠標位置）。
     *   ballWin ?? undefined：如果浮球窗口為 null（理論上不應發生），
     *   傳 undefined，Electron 會選擇焦點窗口彈出。
     */
    const menu = Menu.buildFromTemplate(template)
    const ballWin = windowManager.getFloatingBallWindow()
    menu.popup({ window: ballWin ?? undefined })

    logger.debug('浮球原生右鍵菜單已彈出', 'IPC:ball')
  })

  logger.info('所有 IPC Handlers 注冊完成', 'IPC')
}
