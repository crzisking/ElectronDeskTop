/**
 * Electron 主進程入口。
 * 用於：app.whenReady 後依序啟動 config / window / floatingBall / tray / update / ipc。
 * 模塊順序受依賴關係限制（IPC handler 需要各 manager 已建構）。
 */

import { app } from 'electron'
import { WindowManager } from './window-manager'
import { FloatingBallManager } from './floating-ball'
import { TrayManager } from './tray-manager'
import { ConfigManager } from './config-manager'
import { UpdateManager } from './update-manager'
import { registerAllHandlers } from './ipc-handlers'
import { logger } from './utils/logger'
import { initLogFileWriter } from './utils/log-file-writer'

// Electron API 只能在 whenReady 後使用，所以 manager 先 let 宣告，等 ready 再賦值
let windowManager: WindowManager
let floatingBallMgr: FloatingBallManager
let trayManager: TrayManager
let configManager: ConfigManager
let updateMgr: UpdateManager

app.whenReady().then(async () => {

  // 必須最先 init，後續 logger.error 才能落地到 <userData>/logs/main-YYYY-MM-DD.log
  initLogFileWriter()

  // Windows 任務欄分組 / 通知所需的 AppUserModelId
  app.setAppUserModelId('com.company.enterprise-desktop-client')

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

  // 必須在 registerAllHandlers 前建構，因 update.handlers 需要它的引用
  updateMgr = new UpdateManager(configManager, windowManager, floatingBallMgr, trayManager)

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
 * 退出前清理：托盤圖標、浮球 timer。
 * 不清會殘留托盤圖標 / setInterval 在已銷毀窗口上 tick 報錯。
 */
app.on('before-quit', () => {
  logger.info('應用即將退出，清理資源...', 'App')
  // 進入退出狀態，主窗口 close 不再 preventDefault（讓 quit 正常完成）
  windowManager?.setQuitting(true)
  trayManager?.destroy()
  floatingBallMgr?.dispose()
})

// 主進程未捕獲異常 / 未處理 Promise rejection：只記錄日誌，不退出
process.on('uncaughtException', (error) => {
  logger.error('未捕獲的異常', 'App', error)
})

process.on('unhandledRejection', (reason) => {
  logger.error('未處理的 Promise 拒絕', 'App', reason)
})
