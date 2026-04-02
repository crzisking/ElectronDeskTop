/**
 * ============================================================
 * Electron 主進程入口文件
 * 文件路徑：electron/main/index.ts
 * ============================================================
 *
 * 【什麼是主進程？】
 * Electron 應用有兩種進程：
 *   1. 主進程（Main Process）：Node.js 環境，可以訪問操作系統 API、
 *      創建窗口、讀寫文件等。整個應用只有一個主進程，就是這個文件。
 *   2. 渲染進程（Renderer Process）：每個 BrowserWindow 窗口都有
 *      自己的渲染進程，運行 Vue/HTML/JS，類似瀏覽器環境。
 *
 * 【這個文件的職責】
 * 這是整個 Electron 應用的啟動入口，負責：
 *   1. app.whenReady()：等待 Electron 初始化完成，然後依序啟動各模塊
 *   2. window-all-closed：處理「所有窗口被關閉」的情況
 *   3. activate（macOS）：處理用戶點擊 Dock 圖標的情況
 *   4. before-quit：應用退出前做資源清理
 *
 * 【模塊職責分離】
 *   - WindowManager    → 負責窗口的創建、顯示、隱藏（electron/main/window-manager.ts）
 *   - FloatingBallManager → 負責浮球的拖動邏輯、邊緣吸附動畫（electron/main/floating-ball.ts）
 *   - TrayManager      → 負責系統托盤圖標和右鍵菜單（electron/main/tray-manager.ts）
 *   - ConfigManager    → 負責讀寫磁盤上的 JSON 配置文件（electron/main/config-manager.ts）
 *   - registerAllHandlers → 注冊所有 IPC 通信頻道（electron/main/ipc-handlers/index.ts）
 */

// ─── Import 說明 ──────────────────────────────────────────────────────────────

/**
 * `app`：Electron 內建模塊（electron 包），代表整個應用程序本身。
 *        提供生命週期事件（whenReady、quit 等）和全局方法（setAppUserModelId 等）。
 *        來自：node_modules/electron/electron.d.ts（Electron 官方類型定義）
 */
import { app } from 'electron'

/**
 * `WindowManager`：自定義類，封裝了 BrowserWindow 的創建和管理邏輯。
 *                  來自：./window-manager（即 electron/main/window-manager.ts）
 *                  職責：createMainWindow()、showMainWindow()、hideMainWindow() 等
 */
import { WindowManager } from './window-manager'

/**
 * `FloatingBallManager`：自定義類，管理桌面浮球的行為。
 *                         來自：./floating-ball（即 electron/main/floating-ball.ts）
 *                         職責：startDrag()、stopDrag()、setBallSize()、邊緣吸附動畫
 */
import { FloatingBallManager } from './floating-ball'

/**
 * `TrayManager`：自定義類，管理系統托盤（任務欄右下角的小圖標）。
 *                來自：./tray-manager（即 electron/main/tray-manager.ts）
 *                職責：init()（創建托盤圖標和右鍵菜單）、destroy()（清理托盤）
 */
import { TrayManager } from './tray-manager'

/**
 * `ConfigManager`：自定義類，負責讀寫應用配置文件（JSON 格式存在磁盤）。
 *                  來自：./config-manager（即 electron/main/config-manager.ts）
 *                  職責：load()（從磁盤加載）、getConfig()（返回配置對象）、
 *                        save()（寫回磁盤）
 */
import { ConfigManager } from './config-manager'

/**
 * `registerAllHandlers`：函數，注冊所有 IPC（進程間通信）頻道的處理器。
 *                         來自：./ipc-handlers（即 electron/main/ipc-handlers/index.ts）
 *                         職責：讓渲染進程（Vue 組件）可以通過 IPC 調用主進程功能
 */
import { registerAllHandlers } from './ipc-handlers'

/**
 * `logger`：自定義日誌工具，封裝了帶時間戳、模塊標籤的控制台輸出。
 *            來自：./utils/logger（即 electron/main/utils/logger.ts）
 *            職責：logger.info()、logger.error()、logger.debug() 等
 */
import { logger } from './utils/logger'

// ─── 模塊實例（在 whenReady 後初始化） ──────────────────────────────────────
// 【為什麼用 let 而不在這裡直接 new？】
// 因為 Electron 的 API（BrowserWindow 等）只能在 app.whenReady() 之後使用。
// 在 whenReady() 之前調用這些 API 會拋出錯誤：
//   "Cannot create BrowserWindow before app is ready"
// 所以先聲明變量（此時值為 undefined），等 whenReady() 觸發後再賦值。

/** windowManager：負責所有窗口（主窗口 + 浮球窗口）的創建和管理 */
let windowManager: WindowManager

/** floatingBallMgr：負責浮球的拖動行為、邊緣吸附動畫、大小設置 */
let floatingBallMgr: FloatingBallManager

/** trayManager：負責系統托盤圖標、托盤右鍵菜單 */
let trayManager: TrayManager

/** configManager：負責從磁盤讀取和寫入應用配置（如浮球位置、是否靜默啟動等） */
let configManager: ConfigManager

// ─── 應用就緒 ──────────────────────────────────────────────────────────────
/**
 * app.whenReady()：
 *   - 這是一個 Promise，當 Electron 完成初始化（相當於瀏覽器的 DOMContentLoaded）後 resolve。
 *   - 【為什麼要等它？】
 *     Electron 啟動時需要初始化 GPU 進程、準備渲染環境等。
 *     在此之前，BrowserWindow、Tray 等 API 都無法使用。
 *     app.whenReady() 確保我們在正確的時機才開始創建窗口和注冊功能。
 *   - 使用 .then(async () => {...}) 而不是直接寫 async 函數，
 *     是因為 whenReady() 返回的是 Promise，用 .then() 是標準寫法。
 */
app.whenReady().then(async () => {

  // ─── 前置設置：開發工具 & 應用 ID ────────────────────────────────────

  /**
   * setAppUserModelId：設置 Windows 任務欄的「應用用戶模型 ID」。
   * 作用：讓 Windows 任務欄正確地把同一應用的多個窗口分為一組，
   *       並確保通知、快捷跳轉等功能正常工作。
   * 必須在 whenReady() 後、創建窗口前設置。
   */
  app.setAppUserModelId('com.company.enterprise-desktop-client')

  /**
   * app.isPackaged：
   *   - true  → 已打包發布的正式版本（用戶安裝後運行）
   *   - false → 開發模式（npm run dev 時）
   *
   * 開發模式下，監聽每個新創建的窗口，為其添加 F12 打開 DevTools 的功能。
   * 【為什麼只在開發模式下？】
   * 正式發布的應用不應該讓用戶能隨意打開開發者工具（暴露源碼、破解邏輯等）。
   */
  if (!app.isPackaged) {
    /**
     * 'browser-window-created' 事件：
     *   每次有新的 BrowserWindow 被創建時觸發。
     *   參數：_ 是事件對象（此處不用，用 _ 佔位），window 是剛創建的窗口實例。
     */
    app.on('browser-window-created', (_, window) => {
      /**
       * 'before-input-event' 事件：
       *   在窗口接收到鍵盤輸入之前觸發，可以攔截或響應按鍵。
       *   參數：_ 是事件對象，input 包含按鍵信息（.key、.type 等）。
       */
      window.webContents.on('before-input-event', (_, input) => {
        if (input.key === 'F12') {
          /**
           * toggleDevTools()：切換開發者工具面板（打開/關閉）。
           * 相當於在瀏覽器中按 F12。
           */
          window.webContents.toggleDevTools()
        }
      })
    })
  }

  // ─── Step 1：加載配置 ──────────────────────────────────────────────
  /**
   * 【為什麼 Step 1 是加載配置？】
   * 後續所有步驟（創建窗口大小、浮球位置、是否靜默啟動）
   * 都依賴配置文件中的數據。必須先把配置讀進來，
   * 後面的步驟才能根據配置做出正確的行為。
   *
   * new ConfigManager()：創建配置管理器實例。
   * await configManager.load()：異步讀取磁盤上的 config.json 文件。
   *   【為什麼用 await？】磁盤 I/O 是異步操作，用 await 確保讀完再繼續。
   * configManager.getConfig()：返回已解析的配置對象（AppConfig 類型）。
   */
  configManager = new ConfigManager()
  await configManager.load()
  const config = configManager.getConfig()
  logger.info(`配置加載完成，版本: ${config.version}`, 'App')

  // ─── Step 2：創建窗口管理器並創建窗口 ──────────────────────────────
  /**
   * 【為什麼 Step 2 是創建窗口？】
   * IPC Handler（Step 4）需要引用窗口實例才能向渲染進程發送消息。
   * 托盤（Step 5）也需要窗口實例來實現「點擊托盤顯示窗口」的功能。
   * 所以窗口必須在這些步驟之前先創建好。
   *
   * new WindowManager()：創建窗口管理器，此時還沒有實際窗口。
   * windowManager.createMainWindow()：創建主窗口（Vue 應用的主界面）。
   * windowManager.createFloatingBallWindow()：創建浮球窗口（懸浮在桌面的小球）。
   */
  windowManager = new WindowManager()
  windowManager.createMainWindow()
  windowManager.createFloatingBallWindow()

  // ─── Step 3：創建浮球管理器 ──────────────────────────────────────
  /**
   * 【為什麼 Step 3 是浮球管理器而不是 Step 2？】
   * FloatingBallManager 需要 windowManager 實例作為參數，
   * 以便它能操作浮球窗口（移動位置、觸發吸附動畫等）。
   * 所以必須先有 windowManager，再創建 floatingBallMgr。
   *
   * 參數說明：
   *   windowManager：讓浮球管理器能操作浮球窗口的位置和顯示狀態
   *   config.floatingBall.snapToEdge：布爾值，是否啟用邊緣吸附功能
   */
  floatingBallMgr = new FloatingBallManager(
    windowManager,
    config.floatingBall.snapToEdge
  )

  /**
   * setBallSize()：設置浮球的尺寸（單位：像素）。
   * 浮球窗口大小由配置文件中的 floatingBall.size 決定。
   */
  floatingBallMgr.setBallSize(config.floatingBall.size)

  /**
   * 初始化浮球位置：從配置讀取上次保存的 x、y 座標，
   * 用 setTimeout 延遲 500ms 再設置位置。
   *
   * 【為什麼要延遲 500ms？】
   * BrowserWindow 創建後，窗口的內部渲染尚未完成（WebContents 還在加載 HTML）。
   * 如果立即設置位置，可能因窗口還未完全就緒而導致位置設置失效。
   * 延遲 500ms 是一種「等待窗口穩定」的保守做法。
   */
  const { x, y } = config.floatingBall.defaultPosition
  setTimeout(() => {
    windowManager.setFloatingBallPosition(x, y, config.floatingBall.size)
  }, 500) // 等窗口創建完成

  // ─── Step 4：注冊所有 IPC Handler ────────────────────────────────
  /**
   * 【為什麼 Step 4 在窗口創建（Step 2）之後？】
   * 部分 IPC Handler（如窗口控制類）需要 windowManager 實例，
   * 以便在收到渲染進程的請求時，能操作對應的窗口。
   * 若在窗口創建前注冊 Handler，windowManager 還是 undefined，
   * 處理器執行時會報錯。
   *
   * registerAllHandlers() 接收三個管理器實例，
   * 讓各 Handler 函數可以通過閉包訪問這些實例。
   *
   * 調用位置：本文件，在 windowManager、configManager、floatingBallMgr 都初始化後調用。
   * 定義位置：electron/main/ipc-handlers/index.ts
   */
  registerAllHandlers(windowManager, configManager, floatingBallMgr)

  // ─── Step 5：初始化系統托盤 ──────────────────────────────────────
  /**
   * 【為什麼 Step 5 在 IPC Handler 注冊後？】
   * 托盤的某些菜單操作（如「顯示主窗口」）會發送 IPC 消息給渲染進程，
   * 這要求 IPC Handler 已經注冊好，否則消息會沒有接收者。
   *
   * new TrayManager()：創建托盤管理器，傳入窗口管理器和配置管理器。
   * trayManager.init()：在系統托盤區域創建圖標和右鍵菜單。
   */
  trayManager = new TrayManager(windowManager, configManager)
  trayManager.init()

  // ─── Step 6：根據配置決定啟動模式 ──────────────────────────────
  /**
   * config.app.startMinimized：布爾值，是否「靜默啟動」（最小化啟動）。
   *
   * 【靜默啟動模式】：適合開機自啟場景。
   *   用戶開機後應用自動運行，但不彈出主窗口打擾用戶，
   *   只在任務欄托盤顯示圖標，用戶需要時可以點擊托盤打開。
   *   浮球會顯示在桌面上（因為創建時默認顯示），主窗口則被隱藏。
   *
   * 【普通啟動模式】：默認行為。
   *   主窗口正常顯示。（不執行 hideMainWindow，窗口保持默認可見狀態）
   */
  if (config.app.startMinimized) {
    // 靜默啟動：直接顯示浮球，不顯示主窗口
    windowManager.hideMainWindow()
    logger.info('靜默啟動模式，直接顯示浮球', 'App')
  }

  logger.info('應用初始化完成', 'App')
})

// ─── 所有窗口關閉事件 ──────────────────────────────────────────────────────
/**
 * 'window-all-closed' 事件：
 *   【觸發時機】：當應用的所有 BrowserWindow 都被關閉（destroyed）時觸發。
 *   【正常情況下會觸發嗎？】
 *   本應用在窗口的 'close' 事件中攔截了關閉操作（改為 hide），
 *   所以正常點擊窗口的 × 按鈕時，窗口只是隱藏，不會真正關閉，
 *   此事件通常不會在正常操作下觸發。
 *   【什麼時候可能觸發？】
 *   用戶通過 Windows 任務管理器強制結束進程、或其他異常情況導致窗口被銷毀時。
 *
 * 【為什麼 process.platform !== 'darwin' 但還是什麼都不做？】
 *   macOS 的慣例是關閉所有窗口後應用仍保持活躍（在 Dock 有圖標）。
 *   Windows/Linux 的慣例是關閉所有窗口後應用退出。
 *   但本應用設計為「常駐後台」，所以在 Windows/Linux 下也不退出，
 *   用戶必須通過托盤菜單的「結束應用程式」才能完全退出。
 */
app.on('window-all-closed', () => {
  // 除 macOS 外不退出（繼續在托盤運行）
  // macOS 的應用通常關閉所有窗口後仍保持活躍狀態
  if (process.platform !== 'darwin') {
    // 仍然不退出，通過托盤繼續運行
    // 若需退出，用戶應使用托盤菜單的"結束應用程式"
  }
})

// ─── macOS：點擊 Dock 圖標重新顯示窗口 ────────────────────────────────────
/**
 * 'activate' 事件（僅 macOS）：
 *   【觸發時機】：用戶點擊 macOS Dock 欄中的應用圖標時觸發。
 *   【場景】：用戶把主窗口關閉（隱藏）了，想重新打開，
 *             點擊 Dock 圖標是 macOS 的標準操作方式。
 *   【為什麼要檢查 if (windowManager)？】
 *   理論上 activate 只在 whenReady() 之後才能觸發，
 *   但做防禦性檢查是個好習慣，避免 windowManager 還未初始化時崩潰。
 *
 * 在 Windows/Linux 上此事件不會觸發，相應的功能由托盤圖標承擔。
 */
app.on('activate', () => {
  if (windowManager) {
    windowManager.showMainWindow()
  }
})

// ─── 應用即將退出 ────────────────────────────────────────────────────────
/**
 * 'before-quit' 事件：
 *   【觸發時機】：應用即將退出之前觸發，在所有窗口關閉之前。
 *   【觸發方式】：
 *     - 調用 app.quit() 時（如托盤菜單「結束應用程式」）
 *     - macOS 上通過 Cmd+Q 退出
 *     - 系統關機時 Electron 會嘗試優雅退出
 *   【為什麼要在這裡清理資源？】
 *   如果不清理，可能出現：
 *     - 托盤圖標殘留在系統托盤（需要鼠標移過去才消失）
 *     - 浮球的拖動定時器（setInterval）繼續運行導致報錯
 *
 * trayManager?.destroy()：
 *   ?. 是可選鏈操作符，如果 trayManager 是 undefined（初始化失敗），
 *   不會報錯，直接跳過。正常情況下調用 destroy() 移除托盤圖標。
 *
 * floatingBallMgr?.stopDrag()：
 *   停止浮球拖動的 setInterval 輪詢，避免應用退出後還有定時器在跑。
 */
app.on('before-quit', () => {
  logger.info('應用即將退出，清理資源...', 'App')
  trayManager?.destroy()
  floatingBallMgr?.stopDrag()
})

// ─── 未捕獲的異常 ──────────────────────────────────────────────────────────
/**
 * process.on('uncaughtException', ...)：
 *   【觸發時機】：主進程的 JavaScript 代碼拋出了未被任何 try-catch 捕獲的異常。
 *   【為什麼要處理它？】
 *   Node.js 默認在 uncaughtException 後退出進程。
 *   加上這個監聽器，可以先記錄日誌，便於排查問題。
 *   注意：在生產環境中，嚴重錯誤後仍應考慮退出，這裡只做日誌記錄。
 *
 * process.on('unhandledRejection', ...)：
 *   【觸發時機】：代碼中有 Promise 被 reject，但沒有 .catch() 或 await 的 try-catch。
 *   例如：asyncFunction() 沒有加 await，也沒有 .catch()，拋錯時就會觸發這裡。
 *   【reason 參數】：reject 時傳入的錯誤原因，可能是 Error 對象或任意值。
 */
process.on('uncaughtException', (error) => {
  logger.error('未捕獲的異常', 'App', error)
})

process.on('unhandledRejection', (reason) => {
  logger.error('未處理的 Promise 拒絕', 'App', reason)
})
