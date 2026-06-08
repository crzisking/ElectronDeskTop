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
import {attachLogService, logger} from './utils/logger'
import {initLogFileWriter} from './utils/log-file-writer'
import {ensureAutoLaunchRegistered} from './auto-launch-manager'
import {DatabaseManager} from './db/database-manager'
import {LogService} from './db/features/logs/service'
import {WorkRecordService} from './db/features/work-collect/service'
import {WorkTemplateCacheService} from './db/features/work-collect/template-cache.service'
import {UserProfileService} from './db/features/user-profile/service'
import {SavedCredentialsService} from './db/features/saved-credentials/service'
import {AgentService} from './db/features/agent/service'
import {WorkAnalysisService} from './db/features/work-analysis/service'
import {LlmClient} from './services/llm'
import {AccountChangeCleaner} from './db/account-change-cleaner'
import {WorkCollectorScheduler, WorkCollectSyncService} from './work-collect'
import {NotificationClient} from './services/notification-client'
import {ScriptRunner} from './services/script-runner'
import {registerBuiltinScripts} from './services/scripts'

// Electron API 只能在 whenReady 後使用，所以 manager 先 let 宣告，等 ready 再賦值
let windowManager: WindowManager
let floatingBallMgr: FloatingBallManager
let trayManager: TrayManager
let configManager: ConfigManager
let updateMgr: UpdateManager
let dbManager: DatabaseManager | null = null
let logService: LogService | null = null
let workRecordService: WorkRecordService | null = null
let workTemplateCacheService: WorkTemplateCacheService | null = null
let userProfileService: UserProfileService | null = null
let savedCredentialsService: SavedCredentialsService | null = null
let accountChangeCleaner: AccountChangeCleaner | null = null
// AgentService 沿用 — agent feature UI 已移除,但 agent_configs 表保留作為
// LLM provider 配置儲存(work analysis / 未來 Claude SDK Agent v2 都讀這張表)
let agentService: AgentService | null = null
/**
 * LlmClient 共用層:任何 main process 要呼 LLM 的 feature 都注入這個實例,
 * 不要各自 new OpenAI。null = AgentService 未就緒(DB 沒起來)。
 */
let llmClient: LlmClient | null = null
/** 工作分析報告儲存 */
let workAnalysisService: WorkAnalysisService | null = null
let workCollector: WorkCollectorScheduler
/** 遠程通知 WebSocket 客戶端(docs/18)。登入後由 renderer IPC NOTIFICATION_START 觸發實際連線 */
let notificationClient: NotificationClient
/** 內建腳本派發器,由 NotificationClient 在收到 server task 時調用 */
let scriptRunner: ScriptRunner

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
  workCollector?.dispose()
    // 主動斷開 WebSocket(送 unregister + close),server 端 Registry 立即清掉
    notificationClient?.stop()
  // 必須在 windowManager 銷毀前 close DB,讓 WAL 內容 checkpoint 進主檔;
  // 用 try/catch 防止 close 拋出阻礙退出流程
  try {
    dbManager?.close()
  } catch (err) {
    console.error('[App] DB close 失敗', err)
  }
  windowManager?.destroyAll()
}

app.whenReady().then(async () => {

  // 必須最先 init，後續 logger.error 才能落地到 <userData>/logs/main-YYYY-MM-DD.log
  initLogFileWriter()

  // Windows 任務欄分組 / 通知所需的 AppUserModelId
  app.setAppUserModelId('com.ichia.desktop.client')

  // 強制註冊開機自啟(公司軟體政策)。idempotent,失敗也不影響啟動。
  // dev 環境 / portable 版 / 非 Windows 平台會在函式內自行跳過。
  ensureAutoLaunchRegistered()

  // 初始化 SQLite + 把 LogService 接到 logger,讓後續所有 logger.* 雙寫到 DB。
  // 失敗只 console.error(因為此時 logger 還沒接 DB,寫了也沒意義);
  // 不 attach 的情況下,logger 內 _logService?.write(...) 自動 noop,
  // 文件寫入跟 console 仍正常,App 照常啟動。
  try {
    dbManager = new DatabaseManager()
    dbManager.init()
    logService = new LogService(dbManager)
    attachLogService(logService)
    // 對齊 log-file-writer 的 RETENTION_DAYS=14
    const deleted = logService.cleanupOlderThan(14)
    if (deleted > 0) {
      logger.info(`啟動清理:刪除 ${deleted} 筆 14 天前的舊日誌`, 'DB')
    }
    // 同一個 dbManager,連 work_records / user_profiles service 一起建
    workRecordService = new WorkRecordService(dbManager)
      workTemplateCacheService = new WorkTemplateCacheService(dbManager)
    userProfileService = new UserProfileService(dbManager)
    savedCredentialsService = new SavedCredentialsService(dbManager)
    // cleaner 拿 workRecordService 是為了清表後 invalidate 內部 unsynced counter
    accountChangeCleaner = new AccountChangeCleaner(dbManager, workRecordService)
    agentService = new AgentService(dbManager)
    // LlmClient 依賴 agentService 拿 provider 配置;一起建,出問題一起 null
    llmClient = new LlmClient(agentService)
    workAnalysisService = new WorkAnalysisService(dbManager)
  } catch (err) {
    console.error('[App] DB 初始化失敗,日誌只走 txt + console', err)
    dbManager = null
    logService = null
    workRecordService = null
      workTemplateCacheService = null
    userProfileService = null
    savedCredentialsService = null
    accountChangeCleaner = null
    agentService = null
    llmClient = null
    workAnalysisService = null
  }

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
  // dbManager 是 **fatal dependency** — 因為 config 已搬進 SQLite,DB 連不上 = App 沒法啟動。
  // 既然 fatal,給使用者一個明確的對話框再退出,不要讓 Electron 出 "Uncaught Error" 黑底白字。
  if (!dbManager) {
    const {dialog} = await import('electron')
    dialog.showErrorBox(
        '啟動失敗',
        '本機資料庫初始化失敗,App 無法啟動。\n\n' +
        '可能原因:\n' +
        '  • app.db 檔案損壞或被其他程式佔用\n' +
        '  • 磁碟空間不足 / 寫入權限被擋\n' +
        '  • drizzle migration 失敗\n\n' +
        '請聯絡 IT,或刪除使用者目錄下的 app.db 後重啟(會丟失本機設定)。',
    )
    throw new Error('DatabaseManager 初始化失敗,ConfigManager 無法繼續(config 已搬進 SQLite)')
  }
  configManager = new ConfigManager(dbManager)
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

  // 工作採集 scheduler:必須在 registerAllHandlers 前建構,因 work-collect.handlers 需要它的引用。
  // scheduler 負責 timer + capture + 推 IPC;命中閒置時直接走 recordService 寫 DB 跳過 AI。
    workCollector = new WorkCollectorScheduler(configManager, windowManager, workRecordService, workTemplateCacheService)

  // 集中化 sync(docs/20):main 直接跑 listUnsynced + HTTP + markSynced 全流程,
  // renderer 不需 50× IPC 來回。DB 沒就緒(workRecordService=null)時為 null,handler 自降級。
  const workCollectSyncService = workRecordService ? new WorkCollectSyncService(workRecordService) : null

    // 遠程通知(docs/18):
    //   ScriptRunner 註冊 6 個內建腳本(show-message / clear-cache / restart-app / ...)。
    //   NotificationClient 持有 runner 引用,收到 server task 時 dispatch 給對應 handler。
    //   實際 WebSocket 連線在使用者登入後由 renderer IPC NOTIFICATION_START 觸發,未登入時 idle。
    scriptRunner = new ScriptRunner()
    registerBuiltinScripts(scriptRunner, {configManager, windowManager, logService})
    notificationClient = new NotificationClient(scriptRunner)

  registerAllHandlers({
    windowManager,
    configManager,
    floatingBallMgr,
    updateMgr,
    logService,
    workCollector,
    workRecordService,
      workTemplateCacheService,
    workCollectSyncService,
    userProfileService,
    savedCredentialsService,
    accountChangeCleaner,
    agentService,
    llmClient,
    workAnalysisService,
      notificationClient,
  })

  // 配置 enabled=true 就立刻啟動(等渲染端送 token 來才會真的 tick)
  workCollector.start()

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
