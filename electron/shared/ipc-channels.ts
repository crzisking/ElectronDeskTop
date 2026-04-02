/**
 * ============================================================
 * IPC 頻道常量定義文件
 * 文件路徑：electron/shared/ipc-channels.ts
 * ============================================================
 *
 * 【什麼是 IPC？】
 * IPC（Inter-Process Communication，進程間通信）是 Electron 中
 * 主進程（Main Process）和渲染進程（Renderer Process）互相傳遞消息的機制。
 *
 * 由於安全限制，渲染進程（Vue 組件）無法直接調用 Node.js API，
 * 必須通過 IPC 通道發送消息給主進程，由主進程執行具體操作後返回結果。
 *
 * 通信模型：
 *   渲染進程（Vue 組件）
 *     ↓ 調用 window.electronAPI.xxx()（preload 腳本暴露的方法）
 *   Preload 腳本（electron/preload/）
 *     ↓ 調用 ipcRenderer.invoke('頻道名') 或 ipcRenderer.send('頻道名')
 *   主進程（electron/main/ipc-handlers/）
 *     ↓ ipcMain.handle('頻道名') 或 ipcMain.on('頻道名')
 *   主進程執行業務邏輯並返回結果（invoke/handle 模式）
 *     ↑ 結果返回給 preload，preload 返回給 Vue 組件
 *
 * ─────────────────────────────────────────────────────────────
 *
 * 【為什麼要用常量，而不是直接在代碼裡寫字符串？】
 *
 * 反例（不好的做法）：
 *   // preload 腳本中
 *   ipcRenderer.invoke('config:reaad')  // 拼寫錯誤！多了一個 'a'
 *
 *   // 主進程中
 *   ipcMain.handle('config:read', ...)  // 正確的頻道名
 *
 * 結果：preload 發送的是 'config:reaad'，主進程監聽的是 'config:read'，
 *       兩者不匹配，請求靜默失敗——沒有報錯，但功能不工作，極難排查！
 *
 * 正確做法（本文件的方式）：
 *   // preload 腳本中
 *   ipcRenderer.invoke(IpcChannels.CONFIG_READ)  // 引用常量
 *
 *   // 主進程中
 *   ipcMain.handle(IpcChannels.CONFIG_READ, ...)  // 同一個常量
 *
 * 優點：
 *   1. 編譯時錯誤：寫錯常量名，TypeScript 立即報紅線，不會運行時靜默失敗。
 *   2. IDE 自動補全：輸入 IpcChannels. 後 IDE 列出所有可用頻道。
 *   3. 統一管理：所有頻道名在一個文件中，方便查閱和修改。
 *   4. 重構安全：重命名頻道時，只需改這個文件，編譯器自動找到所有引用處。
 *
 * ─────────────────────────────────────────────────────────────
 *
 * 【命名規範說明】
 *
 * 格式：`模塊:動作`（小寫 + 連字符分隔單詞）
 *   例如：'config:read'、'window:hide'、'floating-ball:start-drag'
 *
 * 常量名採用全大寫 + 下劃線（UPPER_SNAKE_CASE）：
 *   例如：CONFIG_READ、WINDOW_HIDE、BALL_START_DRAG
 *
 * 為什麼常量名和值的格式不同？
 *   - 常量名（UPPER_SNAKE_CASE）是 JavaScript/TypeScript 的命名慣例，
 *     一眼就能看出「這是一個不可變的常量」。
 *   - 值（'config:read'）是在 Electron IPC 系統中傳遞的字符串，
 *     短小便於調試時在日誌中識別。
 *
 * ─────────────────────────────────────────────────────────────
 *
 * 【文件位置說明：為什麼放在 shared/ 目錄？】
 *
 * electron/shared/ 目錄存放主進程和 preload 腳本都需要用到的代碼。
 * 這個文件同時被：
 *   - electron/main/ipc-handlers/（主進程：監聽頻道）
 *   - electron/preload/（預加載腳本：發送請求）
 * 兩個地方引用，所以放在共享目錄。
 *
 * 渲染進程（Vue 組件）不直接引用這個文件，
 * 它只通過 window.electronAPI（preload 暴露的對象）來使用這些功能。
 */

/**
 * IpcChannels：所有 IPC 通信頻道名稱的集合。
 *
 * `as const`：TypeScript 修飾符，讓對象的每個值都變成字面量類型（而非普通 string）。
 * 例如：沒有 as const 時，CONFIG_READ 的類型是 string；
 *        加了 as const 後，CONFIG_READ 的類型是 'config:read'（更精確）。
 * 這讓下面的 IpcChannel 聯合類型能正確推導出所有可能的頻道名。
 */
export const IpcChannels = {

  // ─── 配置管理 ──────────────────────────────────────────────────────────
  /**
   * CONFIG_READ：讀取應用配置。
   *
   * 調用方向（誰發、誰收）：
   *   發送方：preload 腳本的 config.read() 方法
   *           → 使用 ipcRenderer.invoke(IpcChannels.CONFIG_READ)
   *   接收方：electron/main/ipc-handlers/config.handlers.ts
   *           → 使用 ipcMain.handle(IpcChannels.CONFIG_READ, ...)
   *           → 調用 configManager.getConfig()，返回完整的 AppConfig 對象
   *
   * 使用場景：Vue 組件掛載時，調用 window.electronAPI.config.read()
   *            獲取配置，用於初始化 UI（如浮球大小、主題等）。
   * 通信類型：invoke/handle（雙向，有返回值）
   */
  CONFIG_READ: 'config:read',

  /**
   * CONFIG_WRITE：更新並保存部分配置。
   *
   * 調用方向：
   *   發送方：preload 腳本的 config.write(partialConfig) 方法
   *           → 使用 ipcRenderer.invoke(IpcChannels.CONFIG_WRITE, partialConfig)
   *   接收方：electron/main/ipc-handlers/config.handlers.ts
   *           → 合併新配置到現有配置，並寫入磁盤
   *
   * 使用場景：用戶在設置頁面更改浮球大小，保存時調用。
   * 通信類型：invoke/handle（雙向，返回保存是否成功）
   * 傳入數據：Partial<AppConfig>（只需傳入要修改的字段）
   */
  CONFIG_WRITE: 'config:write',

  // ─── 主窗口控制 ──────────────────────────────────────────────────────────
  /**
   * WINDOW_MINIMIZE：最小化主窗口（縮到任務欄，不退出，不顯示浮球）。
   *
   * 調用方向：
   *   發送方：主窗口的自定義標題欄「最小化」按鈕（Vue 組件）
   *           → window.electronAPI.window.minimize()
   *   接收方：electron/main/ipc-handlers/window.handlers.ts
   *           → 調用 windowManager.getMainWindow().minimize()
   *
   * 通信類型：on/send（單向，無返回值）
   */
  WINDOW_MINIMIZE: 'window:minimize',

  /**
   * WINDOW_MAXIMIZE：最大化主窗口（如果已最大化則還原為普通大小）。
   *
   * 調用方向：
   *   發送方：主窗口標題欄「最大化/還原」按鈕（Vue 組件）
   *           → window.electronAPI.window.maximize()
   *   接收方：electron/main/ipc-handlers/window.handlers.ts
   *           → 切換 maximize() / unmaximize()
   *
   * 通信類型：on/send（單向，無返回值）
   */
  WINDOW_MAXIMIZE: 'window:maximize',

  /**
   * WINDOW_CLOSE：點擊主窗口的「關閉」按鈕時的操作。
   *
   * 【注意】這裡的「關閉」不是真正退出應用，而是：
   *   隱藏主窗口 + 顯示浮球（應用繼續在後台運行）
   *
   * 調用方向：
   *   發送方：主窗口標題欄「×」按鈕（Vue 組件）
   *           → window.electronAPI.window.close()
   *   接收方：electron/main/ipc-handlers/window.handlers.ts
   *           → 調用 windowManager.hideMainWindow()（隱藏而非銷毀）
   *
   * 通信類型：on/send（單向，無返回值）
   */
  WINDOW_CLOSE: 'window:close',

  /**
   * WINDOW_SHOW：顯示主窗口並帶到前台（focus）。
   *
   * 調用方向：
   *   發送方：托盤菜單「打開主窗口」選項、浮球菜單「打開」選項
   *   接收方：electron/main/ipc-handlers/window.handlers.ts
   *           → 調用 windowManager.showMainWindow()
   *
   * 通信類型：on/send（單向，無返回值）
   */
  WINDOW_SHOW: 'window:show',

  /**
   * WINDOW_HIDE：隱藏主窗口並顯示浮球。
   *
   * 調用方向：
   *   發送方：主窗口內的某些操作（如切換到浮球模式的按鈕）
   *   接收方：electron/main/ipc-handlers/window.handlers.ts
   *           → 調用 windowManager.hideMainWindow() 並顯示浮球
   *
   * 通信類型：on/send（單向，無返回值）
   */
  WINDOW_HIDE: 'window:hide',

  /**
   * WINDOW_IS_MAXIMIZED：查詢主窗口當前是否處於最大化狀態。
   *
   * 調用方向：
   *   發送方：主窗口的自定義標題欄（需要顯示「最大化」還是「還原」圖標）
   *           → window.electronAPI.window.isMaximized()
   *   接收方：electron/main/ipc-handlers/window.handlers.ts
   *           → 返回 mainWindow.isMaximized()（boolean）
   *
   * 使用場景：組件掛載時查詢初始狀態，決定顯示哪個按鈕圖標。
   * 通信類型：invoke/handle（雙向，返回 boolean）
   */
  WINDOW_IS_MAXIMIZED: 'window:is-maximized',

  // ─── 浮球控制 ──────────────────────────────────────────────────────────
  /**
   * BALL_SHOW：讓浮球窗口可見（顯示在桌面上）。
   *
   * 調用方向：
   *   發送方：主窗口隱藏時（windowManager.hideMainWindow 內部邏輯）
   *           或托盤菜單「顯示浮球」
   *   接收方：electron/main/ipc-handlers/index.ts
   *           → 調用 windowManager.showFloatingBall()
   *
   * 通信類型：on/send（單向，無返回值）
   */
  BALL_SHOW: 'floating-ball:show',

  /**
   * BALL_HIDE：隱藏浮球窗口（但不銷毀，隨時可以重新顯示）。
   *
   * 調用方向：
   *   發送方：主窗口顯示時（顯示主窗口後隱藏浮球，避免遮擋）
   *   接收方：electron/main/ipc-handlers/index.ts
   *           → 調用 windowManager.hideFloatingBall()
   *
   * 通信類型：on/send（單向，無返回值）
   */
  BALL_HIDE: 'floating-ball:hide',

  /**
   * BALL_START_DRAG：開始拖動浮球。
   *
   * 調用方向：
   *   發送方：浮球的 preload 腳本（electron/preload/floating-ball.preload.ts）
   *           的 startDrag() 方法
   *           → 觸發時機：用戶在浮球上按下鼠標（mousedown 事件）
   *   接收方：electron/main/ipc-handlers/index.ts
   *           → 調用 floatingBallMgr.startDrag()
   *           → floatingBallMgr 啟動 setInterval，以約 60fps 的頻率
   *              輪詢鼠標光標的屏幕座標，並移動浮球窗口跟隨鼠標
   *
   * 通信類型：on/send（單向，無返回值）
   */
  BALL_START_DRAG: 'floating-ball:start-drag',

  /**
   * BALL_STOP_DRAG：停止拖動浮球，觸發邊緣吸附動畫。
   *
   * 調用方向：
   *   發送方：浮球的 preload 腳本的 stopDrag() 方法
   *           → 觸發時機：用戶鬆開鼠標（mouseup 事件）
   *   接收方：electron/main/ipc-handlers/index.ts
   *           → 調用 floatingBallMgr.stopDrag()
   *           → 停止 setInterval，計算最近的屏幕邊緣，
   *              執行滑動動畫將浮球吸附到邊緣
   *
   * 通信類型：on/send（單向，無返回值）
   */
  BALL_STOP_DRAG: 'floating-ball:stop-drag',

  /**
   * BALL_GET_POSITION：獲取浮球當前在屏幕上的座標。
   *
   * 調用方向：
   *   發送方：浮球的 preload 腳本的 getPosition() 方法
   *   接收方：electron/main/ipc-handlers/index.ts
   *           → 調用 windowManager.getFloatingBallPosition()
   *           → 返回 { x: number; y: number }
   *
   * 使用場景：浮球渲染進程需要知道自己的屏幕位置時調用。
   * 通信類型：invoke/handle（雙向，返回 { x, y }）
   */
  BALL_GET_POSITION: 'floating-ball:get-position',

  /**
   * BALL_MENU_ACTION：浮球菜單選項被點擊時，通知主進程執行對應動作。
   *
   * 調用方向：
   *   發送方：浮球的 preload 腳本的 executeMenuAction(type, payload) 方法
   *           → 觸發時機：用戶點擊浮球的快捷菜單項
   *   接收方：electron/main/ipc-handlers/index.ts
   *           → 根據 type 決定動作：
   *             - 'navigate'：顯示主窗口並跳轉到指定路由
   *             - 'quit-app'：退出應用
   *             等等...
   *
   * 傳入數據：type（動作類型字符串）+ 可選的 payload（如路由名稱）
   * 通信類型：on/send（單向，無返回值）
   */
  BALL_MENU_ACTION: 'floating-ball:menu-action',

  // ─── Auth Token（OS 鑰匙串） ──────────────────────────────────────────
  /**
   * AUTH_GET_TOKEN：從操作系統的安全鑰匙串中讀取 Access Token。
   *
   * 【為什麼用 OS 鑰匙串而不是 localStorage？】
   * localStorage 存在渲染進程，數據保存在用戶目錄的明文文件中，不安全。
   * OS 鑰匙串（Windows 的 Credential Manager、macOS 的 Keychain）
   * 由操作系統加密保存，只有本應用能讀取，安全性更高。
   *
   * 調用方向：
   *   發送方：主窗口的 preload 腳本的 auth.getToken() 方法
   *   接收方：electron/main/ipc-handlers/auth.handlers.ts
   *           → 調用 keytar.getPassword() 從 OS 鑰匙串讀取
   *           → 返回 token 字符串 或 null（未找到時）
   *
   * 通信類型：invoke/handle（雙向，返回 string | null）
   */
  AUTH_GET_TOKEN: 'auth:get-token',

  /**
   * AUTH_SET_TOKEN：將 Access Token 安全存入 OS 鑰匙串。
   *
   * 調用方向：
   *   發送方：主窗口的 preload 腳本的 auth.setToken(token) 方法
   *           → 觸發時機：用戶登錄成功後
   *   接收方：electron/main/ipc-handlers/auth.handlers.ts
   *           → 調用 keytar.setPassword() 保存到 OS 鑰匙串
   *
   * 傳入數據：token（string，JWT 或 OAuth Access Token）
   * 通信類型：invoke/handle（雙向，返回是否保存成功的 boolean）
   */
  AUTH_SET_TOKEN: 'auth:set-token',

  /**
   * AUTH_DELETE_TOKEN：從 OS 鑰匙串刪除已保存的 Access Token。
   *
   * 調用方向：
   *   發送方：主窗口的 preload 腳本的 auth.deleteToken() 方法
   *           → 觸發時機：用戶點擊「登出」按鈕
   *   接收方：electron/main/ipc-handlers/auth.handlers.ts
   *           → 調用 keytar.deletePassword() 從 OS 鑰匙串刪除
   *
   * 通信類型：invoke/handle（雙向，返回是否刪除成功的 boolean）
   */
  AUTH_DELETE_TOKEN: 'auth:delete-token',

  // ─── 主進程推送事件（主 → 渲染，單向推送） ────────────────────────────
  /**
   * 【什麼是主進程推送？】
   * 上面的頻道都是渲染進程「主動問」主進程（請求-響應模式）。
   * 但有些情況下，主進程需要「主動通知」渲染進程，
   * 例如配置文件被外部修改了、用戶點擊了托盤圖標。
   * 這時主進程使用 mainWindow.webContents.send(channel, data) 主動推送。
   * 渲染進程（通過 preload 暴露的 on() 方法）監聽這些頻道。
   *
   * 注意：PUSH_ 前綴的頻道不需要在 ipcMain.handle/on 中注冊，
   *        它們是由主進程「發出」的，只需在渲染進程中監聽。
   */

  /**
   * PUSH_CONFIG_CHANGED：主進程推送通知，配置文件在磁盤上被外部程序修改。
   *
   * 推送方向：
   *   發送方：electron/main/config-manager.ts（監聽文件系統變化時觸發）
   *           → 使用 mainWindow.webContents.send(IpcChannels.PUSH_CONFIG_CHANGED)
   *   接收方：主窗口 Vue 組件
   *           → 通過 window.electronAPI.on('push:config-changed', callback)
   *           → 收到後重新調用 CONFIG_READ 刷新配置
   *
   * 使用場景：用戶用文本編輯器手動修改了配置文件，應用自動感知並刷新 UI。
   */
  PUSH_CONFIG_CHANGED: 'push:config-changed',

  /**
   * PUSH_TRAY_CLICKED：用戶點擊了系統托盤圖標（單擊，非右鍵）。
   *
   * 推送方向：
   *   發送方：electron/main/tray-manager.ts（托盤圖標的 click 事件回調）
   *   接收方：主窗口 Vue 組件（如果有 UI 需要響應托盤點擊的話）
   *
   * 通常托盤點擊直接在主進程處理（顯示/隱藏窗口），
   * 此頻道供渲染進程需要感知托盤交互的場景使用。
   */
  PUSH_TRAY_CLICKED: 'push:tray-clicked',

  /**
   * PUSH_WINDOW_MAXIMIZED：主窗口的最大化狀態發生改變。
   *
   * 推送方向：
   *   發送方：electron/main/window-manager.ts
   *           → 監聽 BrowserWindow 的 'maximize' 和 'unmaximize' 事件
   *           → 使用 mainWindow.webContents.send(IpcChannels.PUSH_WINDOW_MAXIMIZED, isMaximized)
   *   接收方：主窗口的自定義標題欄 Vue 組件
   *           → 收到後更新「最大化/還原」按鈕的圖標
   *
   * 傳入數據：boolean（true = 已最大化，false = 已還原為普通大小）
   *
   * 使用場景：用戶雙擊標題欄、拖到屏幕頂部等操作讓窗口最大化，
   *            標題欄需要同步更新按鈕狀態。
   */
  PUSH_WINDOW_MAXIMIZED: 'push:window-maximized'

} as const

/**
 * IpcChannel：所有 IPC 頻道名稱的 TypeScript 聯合類型。
 *
 * `(typeof IpcChannels)[keyof typeof IpcChannels]` 的含義：
 *   - typeof IpcChannels：獲取 IpcChannels 對象的類型
 *   - keyof typeof IpcChannels：獲取所有鍵名的聯合類型
 *     （即 'CONFIG_READ' | 'CONFIG_WRITE' | 'WINDOW_MINIMIZE' | ...）
 *   - (typeof IpcChannels)[keyof typeof IpcChannels]：取所有鍵對應值的類型
 *     （即 'config:read' | 'config:write' | 'window:minimize' | ...）
 *
 * 用途：讓接受頻道名的函數參數有精確的類型約束，
 *        傳入不存在的頻道名時 TypeScript 會報錯。
 * 例如：function listenTo(channel: IpcChannel) {...}
 */
export type IpcChannel = (typeof IpcChannels)[keyof typeof IpcChannels]
