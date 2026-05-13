/**
 * IPC 頻道常量集合。
 * 用於：electron/main/ipc-handlers/* 與 electron/preload/* 共享，避免字面量拼寫錯誤。
 * 命名格式：常量 UPPER_SNAKE_CASE，值為 '模塊:動作'。`as const` 讓值保留字面量類型。
 */
export const IpcChannels = {

  // ─── 認證 / AD 自動登入 ─────────────────────────────────────────────
  // 註：Token 仍然只放渲染端 Pinia store（auth.store.ts），不持久化到磁盤。
  // 此處新增的 AUTH_GET_AD_ACCOUNT 只用來取本機 Windows 帳號名（非 token），
  // 渲染端拿到帳號名後自行去後端換 token。

  /**
   * AUTH_GET_AD_ACCOUNT：取得當前 Windows 登入帳號名（如 "jacky.chen"）。
   * 主進程透過 os.userInfo().username 取得；非 Windows 平台返回空字串。
   * preload.auth.getAdAccount → auth.handlers。invoke。
   */
  AUTH_GET_AD_ACCOUNT: 'auth:get-ad-account',

  /**
   * AUTH_AD_LOGIN：用 AD 帳號名向後端換 JWT。
   *
   * 為什麼放主進程而非渲染端直接 axios:
   *  - 渲染端 (localhost:5173) 打跨域接口會觸發 CORS preflight,後端未配合則被擋
   *  - 主進程是 Node 環境,沒有 CORS,可直接打
   *  - 同時把 Authorization header 等敏感常數留在主進程,不暴露給網頁端
   *
   * payload: account 字串
   * 返回: JWT 字串(空字串視為失敗)
   * preload.auth.adLogin → auth.handlers。invoke。
   */
  AUTH_AD_LOGIN: 'auth:ad-login',

  // ─── 配置管理 ──────────────────────────────────────────────────────────
  /** CONFIG_READ：讀取完整 AppConfig。preload.config.read → config.handlers。invoke。 */
  CONFIG_READ: 'config:read',

  /** CONFIG_WRITE：寫入 Partial<AppConfig> 並落地。preload.config.write → config.handlers。invoke。 */
  CONFIG_WRITE: 'config:write',

  // ─── 主窗口控制 ──────────────────────────────────────────────────────────
  /** WINDOW_MINIMIZE：最小化主窗口到任務欄。標題欄按鈕 → window.handlers。send。 */
  WINDOW_MINIMIZE: 'window:minimize',

  /** WINDOW_MAXIMIZE：最大化/還原切換。標題欄按鈕 → window.handlers。send。 */
  WINDOW_MAXIMIZE: 'window:maximize',

  /** WINDOW_CLOSE：「×」按鈕 = 隱藏主窗 + 顯示浮球（非真正退出）。send。 */
  WINDOW_CLOSE: 'window:close',

  /** WINDOW_SHOW：顯示主窗口並聚焦。托盤/浮球菜單觸發。send。 */
  WINDOW_SHOW: 'window:show',

  /** WINDOW_HIDE：隱藏主窗口並顯示浮球。send。 */
  WINDOW_HIDE: 'window:hide',

  /** WINDOW_IS_MAXIMIZED：查詢最大化狀態（boolean），用於標題欄圖標切換。invoke。 */
  WINDOW_IS_MAXIMIZED: 'window:is-maximized',

  // ─── 浮球控制 ──────────────────────────────────────────────────────────
  /** BALL_SHOW：顯示浮球窗口。send。 */
  BALL_SHOW: 'floating-ball:show',

  /** BALL_HIDE：隱藏浮球窗口（不銷毀）。send。 */
  BALL_HIDE: 'floating-ball:hide',

  /** BALL_START_DRAG：浮球 mousedown 開始拖動，主進程以約 60fps 輪詢鼠標座標。send。 */
  BALL_START_DRAG: 'floating-ball:start-drag',

  /** BALL_STOP_DRAG：浮球 mouseup 停止拖動，觸發邊緣吸附動畫。send。 */
  BALL_STOP_DRAG: 'floating-ball:stop-drag',

  /** BALL_GET_POSITION：返回浮球座標 { x, y }。invoke。 */
  BALL_GET_POSITION: 'floating-ball:get-position',

  /**
   * BALL_SHOW_CONTEXT_MENU：浮球右鍵 → 主進程彈原生 Menu（浮球 60×60 太小渲染不下）。
   * 浮球 preload → main 的 ipc-handlers/index.ts。send。
   */
  BALL_SHOW_CONTEXT_MENU: 'floating-ball:show-context-menu',

  /**
   * APP_QUIT：徹底退出應用（不是隱藏到浮球）。
   * 浮球菜單 / 托盤菜單的「結束應用程式」項使用。send。
   */
  APP_QUIT: 'app:quit',

  // ─── 主進程推送事件（主 → 渲染，單向） ────────────────────────────
  // 注意：PUSH_ 前綴僅由主進程 webContents.send 發出，無需在 ipcMain 註冊。

  /** PUSH_CONFIG_CHANGED：配置文件被外部修改，提示渲染端重新讀取。 */
  PUSH_CONFIG_CHANGED: 'push:config-changed',

  /** PUSH_TRAY_CLICKED：托盤圖標被單擊。 */
  PUSH_TRAY_CLICKED: 'push:tray-clicked',

  /** PUSH_WINDOW_MAXIMIZED：最大化狀態變化（payload: boolean），用於同步標題欄圖標。 */
  PUSH_WINDOW_MAXIMIZED: 'push:window-maximized',

  /**
   * PUSH_BALL_NAVIGATE：浮球/托盤右鍵菜單選了某項導航時,主進程通知主窗口跳轉路由。
   * payload：routeName 字串。主窗口 App.vue 監聽。
   */
  PUSH_BALL_NAVIGATE: 'floating-ball:navigate',

  // ─── 子窗口控制 ──────────────────────────────────────────────────────────
  /**
   * OPEN_CHILD_WINDOW：打開新 BrowserWindow 載入 URL。
   * 參數：url, title。用於統一平台 openMode='electron-window' 卡片。invoke。
   */
  OPEN_CHILD_WINDOW: 'window:open-child',

  // ─── 自動更新（electron-updater） ──────────────────────────────────────
  /** UPDATE_CHECK：手動檢查更新。preload.update.check → UpdateManager.check。invoke。 */
  UPDATE_CHECK: 'update:check',

  /** UPDATE_DOWNLOAD：autoDownload=false 時手動觸發下載。invoke。 */
  UPDATE_DOWNLOAD: 'update:download',

  /** UPDATE_QUIT_AND_INSTALL：退出並安裝新版。invoke。 */
  UPDATE_QUIT_AND_INSTALL: 'update:quit-and-install',

  /** PUSH_UPDATE_CHECKING：開始檢查（可選 UI）。 */
  PUSH_UPDATE_CHECKING: 'push:update-checking',

  /** PUSH_UPDATE_AVAILABLE：發現新版（payload：{ version, releaseNotes? }）。 */
  PUSH_UPDATE_AVAILABLE: 'push:update-available',

  /** PUSH_UPDATE_NOT_AVAILABLE：當前已是最新版（手動檢查時可給用戶提示）。 */
  PUSH_UPDATE_NOT_AVAILABLE: 'push:update-not-available',

  /** PUSH_UPDATE_PROGRESS：下載進度（payload：{ percent, bytesPerSecond, transferred, total }）。 */
  PUSH_UPDATE_PROGRESS: 'push:update-progress',

  /** PUSH_UPDATE_DOWNLOADED：下載完成、等待安裝（payload：{ version }）。 */
  PUSH_UPDATE_DOWNLOADED: 'push:update-downloaded',

  /** PUSH_UPDATE_ERROR：更新流程出錯（payload：{ message }）。 */
  PUSH_UPDATE_ERROR: 'push:update-error',

  // ─── 日誌 ──────────────────────────────────────────────────────────────
  /**
   * LOG_WRITE：渲染端日誌寫入主進程文件（單向 send）。
   * payload：{ level: 'DEBUG'|'INFO'|'WARN'|'ERROR', message, module?, args? }
   */
  LOG_WRITE: 'log:write',

  /** LOG_OPEN_FOLDER：在系統檔案總管中打開日誌資料夾，返回絕對路徑。invoke。 */
  LOG_OPEN_FOLDER: 'log:open-folder'

} as const

/**
 * IpcChannel：所有頻道值的聯合類型，用於約束接受頻道名的函數參數。
 */
export type IpcChannel = (typeof IpcChannels)[keyof typeof IpcChannels]
