/**
 * Electron 主進程入口。
 * 用於：app.whenReady 後依序啟動 config / window / floatingBall / tray / update / ipc。
 * 模塊順序受依賴關係限制（IPC handler 需要各 manager 已建構）。
 */

import {app} from 'electron'
import {WindowManager} from './window-manager'
import {FloatingBallManager} from './floating-ball'
import {TrayManager} from './tray-manager'
import {ConfigManager} from './config-manager'
import {UpdateManager} from './update-manager'
import {registerAllHandlers} from './ipc-handlers'
import {logger} from './utils/logger'
import {initLogFileWriter} from './utils/log-file-writer'

// Electron API 只能在 whenReady 後使用，所以 manager 先 let 宣告，等 ready 再賦值
let windowManager: WindowManager
let floatingBallMgr: FloatingBallManager
let trayManager: TrayManager
let configManager: ConfigManager
let updateMgr: UpdateManager

/**
 * 單例鎖：確保整個應用只能有一個實例在運行。
 *
 * 為什麼需要：
 *   應用會把 Token、配置、日誌寫入 userData 目錄；若用戶連點兩次快捷方式
 *   或從不同入口同時啟動，多個實例會並發寫同一份檔案，造成 Token 互相
 *   覆蓋、配置漂移、日誌交錯不可讀。
 *
 * 行為：
 *   - 第一個實例：拿到鎖，照常啟動。
 *   - 第二個及之後實例：拿不到鎖 → 立刻 quit；同時 OS 會把參數轉發給
 *     第一個實例的 'second-instance' 事件，我們在那裡把主窗口顯示出來。
 *
 * 必須放在 app.whenReady() 之前，搶鎖越早越好。
 */
const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  // 拿不到鎖 → 已有實例在跑，本實例直接退出
  app.quit()
  // app.quit 是異步信號，這裡用 process.exit 確保後續 whenReady 不會再執行
  process.exit(0)
}

// 第二個實例試圖啟動時，把現有主窗口拉到前台
app.on('second-instance', () => {
  if (windowManager) {
    windowManager.showMainWindow()
    const mainWin = windowManager.getMainWindow()
    if (mainWin) {
      if (mainWin.isMinimized()) mainWin.restore()
      mainWin.focus()
    }
    logger.info('檢測到第二個實例啟動，已將主窗口拉到前台', 'App')
  }
})

/**
 * 統一的退出前清理函數。
 * 集中管理所有資源清理邏輯，避免在 tray-manager / update-manager / index.ts 三處重複。
 * 各退出入口（托盤菜單退出、更新安裝退出、系統信號退出）都應呼叫此函數。
 */
function gracefulShutdown(): void {
  logger.info('應用即將退出，清理資源...', 'App')
  // 進入退出狀態，主窗口 close 不再 preventDefault（讓 quit 正常完成）
  windowManager?.setQuitting(true)
  trayManager?.destroy()
  floatingBallMgr?.dispose()
  updateMgr?.dispose()
  windowManager?.destroyAll()
}

app.whenReady().then(async () => {

  // 必須最先 init，後續 logger.error 才能落地到 <userData>/logs/main-YYYY-MM-DD.log
  initLogFileWriter()

  // Windows 任務欄分組 / 通知所需的 AppUserModelId
  app.setAppUserModelId('com.ichia.desktop.client')

  // 開發模式：所有窗口都允許 F12 開 DevTools；正式包不暴露
  if (!app.isPackaged) {
    app.on('browser-window-created', (_, window) => {
      window.webContents.on('before-input-event', (_, input) => {
        if (input.key === 'F12') {
          window.webContents.toggleDevTools()
        }
      })
    })
  }

  // 後續所有步驟都依賴配置（窗口大小、浮球位置、靜默啟動等）
  configManager = new ConfigManager()
  await configManager.load()
  const config = configManager.getConfig()
  logger.info(`配置加載完成，版本: ${config.version}`, 'App')

  // 窗口必須先建好，後面 IPC handler / tray 才能引用實例
  windowManager = new WindowManager()
  windowManager.createMainWindow()
  windowManager.createFloatingBallWindow()

  floatingBallMgr = new FloatingBallManager(
    windowManager,
    config.floatingBall.snapToEdge
  )

  floatingBallMgr.setBallSize(config.floatingBall.size)

  // 延遲 500ms 等浮球 WebContents 就緒，否則 setPosition 可能無效
  const { x, y } = config.floatingBall.defaultPosition
  setTimeout(() => {
    windowManager.setFloatingBallPosition(x, y, config.floatingBall.size)
  }, 500)

  // TrayManager 作為 UpdateManager 的依賴注入；init() 延後到 IPC 註冊後
  trayManager = new TrayManager(windowManager, configManager)

  // 注入統一的退出清理函數，避免 tray-manager 中重複退出邏輯
  trayManager.setQuitCallback(gracefulShutdown)

  // 必須在 registerAllHandlers 前建構，因 update.handlers 需要它的引用
  updateMgr = new UpdateManager(configManager, windowManager, floatingBallMgr, trayManager)

  // 注入統一的退出清理函數，避免 update-manager 中重複退出邏輯
  updateMgr.setQuitCallback(gracefulShutdown)

  registerAllHandlers(windowManager, configManager, floatingBallMgr, updateMgr)

  // 在 IPC handler 註冊後才 init，托盤菜單點擊才能正確觸發處理器
  trayManager.init()

  // 靜默啟動：開機自啟場景，主窗口隱藏只顯示浮球
  if (config.app.startMinimized) {
    windowManager.hideMainWindow()
    logger.info('靜默啟動模式，直接顯示浮球', 'App')
  }

  // 必須在主窗口建好後 init，UpdateManager 要把事件推送到主窗口渲染進程
  const mainWindow = windowManager.getMainWindow()
  if (mainWindow) {
    updateMgr.init(mainWindow)
  } else {
    logger.warn('主窗口尚未就緒，自動更新未啟動', 'App')
  }

  logger.info('應用初始化完成', 'App')
})

/**
 * 本應用設計為常駐後台，所有平台都不在窗口全關時退出。
 * 用戶必須通過托盤菜單「結束應用程式」才能退出。
 */
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    // 不退出，繼續在托盤運行
  }
})

// macOS Dock 圖標點擊：重新顯示主窗口（Windows/Linux 由托盤承擔）
app.on('activate', () => {
  if (windowManager) {
    windowManager.showMainWindow()
  }
})

/**
 * 退出前清理：呼叫統一的 gracefulShutdown。
 */
app.on('before-quit', () => {
  gracefulShutdown()
})

// 主進程未捕獲異常 / 未處理 Promise rejection：只記錄日誌，不退出
process.on('uncaughtException', (error) => {
  logger.error('未捕獲的異常', 'App', error)
})

process.on('unhandledRejection', (reason) => {
  logger.error('未處理的 Promise 拒絕', 'App', reason)
})
