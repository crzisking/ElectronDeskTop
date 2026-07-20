/**
 * Electron 主進程入口。
 * 用於：app.whenReady 後依序啟動 config / window / floatingBall / tray / update / ipc。
 * 模塊順序受依賴關係限制（IPC handler 需要各 manager 已建構）。
 */

import {app, globalShortcut} from 'electron'
import {WindowManager} from './window-manager'
import {FloatingBallManager} from './floating-ball'
import {TrayManager} from './tray-manager'
import {ConfigManager} from './config-manager'
import {UpdateManager} from './update-manager'
import {registerAllHandlers} from './ipc-handlers'
import {AgentConfigStore} from './agent/config-store'
import {AgentDbAdapter} from './agent/db-adapter'
import {AgentEventBridge} from './agent/event-bridge'
import {AgentRuntime} from './agent/runtime'
import {IdeaConfigStore} from './idea-capture/config-store'
import {IdeaRefiner} from './idea-capture/refiner'
import {IdeaHotkeyManager} from './idea-capture/hotkey-manager'
import {registerDailyAdviceHandlers} from './ipc-handlers/daily-advice.handlers'
import {DailyAdviceScheduler} from './services/daily-advice/scheduler'
import {attachLogService, logger} from './utils/logger'
import {initLogFileWriter} from './utils/log-file-writer'
import {ensureAutoLaunchRegistered} from './auto-launch-manager'
import {DatabaseManager} from './db/database-manager'
import {LogService} from './db/features/logs/service'
import {WorkCollectorScheduler, WorkCollectSyncService} from './work-collect'
import {createDbServices, type DbServices} from './create-services'
import {NotificationClient} from './services/notification-client'
import {ScriptRunner} from './services/script-runner'
import {registerBuiltinScripts} from './services/scripts'
import {IpcChannels} from '../shared/ipc-channels'

// Electron API 只能在 whenReady 後使用，所以 manager 先 let 宣告，等 ready 再賦值
let windowManager: WindowManager
let floatingBallMgr: FloatingBallManager
let trayManager: TrayManager
let configManager: ConfigManager
let updateMgr: UpdateManager
let dbManager: DatabaseManager | null = null
let logService: LogService | null = null
// DB 依賴的一組服務統一走工廠(見 create-services.ts);DB 未就緒時整包為 null。
// 只在 whenReady 內用,故不放模組層 —— 見下方 whenReady 內的 `let services`。
let dailyAdviceScheduler: DailyAdviceScheduler | null = null
let workCollector: WorkCollectorScheduler
/** 遠程通知 WebSocket 客戶端(docs/18)。登入後由 renderer IPC NOTIFICATION_START 觸發實際連線 */
let notificationClient: NotificationClient
/** 內建腳本派發器,由 NotificationClient 在收到 server task 時調用 */
let scriptRunner: ScriptRunner
/** 靈感速記(docs/21):全域熱鍵管理;gracefulShutdown 要 unregister,故提到模組層 */
let ideaHotkey: IdeaHotkeyManager | null = null

/** 桌面代辦(docs/23):錄入小窗全域熱鍵(P1 硬編碼,後續可配置) */
const TODO_HOTKEY = 'CommandOrControl+/'

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
    dailyAdviceScheduler?.dispose()
    ideaHotkey?.unregister()
    try {
        globalShortcut.unregister(TODO_HOTKEY)
    } catch { /* ignore */
    }
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
  let services: DbServices | null = null
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
    // DB 依賴服務統一走工廠(構造順序=依賴順序,見 create-services.ts)
    services = createDbServices(dbManager)
  } catch (err) {
    console.error('[App] DB 初始化失敗,日誌只走 txt + console', err)
    dbManager = null
    logService = null
    services = null
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
  if (!dbManager || !services) {
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
    // 桌面代辦(docs/23):頂部 dock 常駐,開機即建(透明穿透,不擋幹活)
    windowManager.createTodoDockWindow()

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
    workCollector = new WorkCollectorScheduler(configManager, windowManager, services.workRecordService, services.workTemplateCacheService)

  // 集中化 sync(docs/11):main 直接跑 listUnsynced + HTTP + markSynced 全流程,
  // renderer 不需 50× IPC 來回。DB 沒就緒(workRecordService=null)時為 null,handler 自降級。
  const workCollectSyncService = new WorkCollectSyncService(services.workRecordService)

    // 遠程通知(docs/18):
    //   ScriptRunner 註冊 6 個內建腳本(show-message / clear-cache / restart-app / ...)。
    //   NotificationClient 持有 runner 引用,收到 server task 時 dispatch 給對應 handler。
    //   實際 WebSocket 連線在使用者登入後由 renderer IPC NOTIFICATION_START 觸發,未登入時 idle。
    scriptRunner = new ScriptRunner()
    registerBuiltinScripts(scriptRunner, {configManager, windowManager, logService})
    notificationClient = new NotificationClient(scriptRunner)

    // Agent v2(docs/19):config/db 用 dbManager,event-bridge 用 windowManager 推串流。
    // dbManager 此處已保證非 null(上方 !dbManager 直接 throw)。
    const agentConfigStore = new AgentConfigStore(dbManager)
    const agentDbAdapter = new AgentDbAdapter(dbManager)
    // 模型連線復用現有模型設定的 active provider(agentService)
    const agentRuntime = new AgentRuntime(agentConfigStore, agentDbAdapter, new AgentEventBridge(windowManager), services.agentService)

    // 靈感速記(docs/21):配置(熱鍵)/ 後台完善佇列 / 熱鍵管理 / 速記小窗。
  // ⚠️ AI 完善在後端跑(後端 Qwen);refiner 只負責非同步呼叫後端 + 推送,不吃桌面端本地模型。
    const ideaConfigStore = new IdeaConfigStore(dbManager)
  const ideaRefiner = new IdeaRefiner(windowManager)
    ideaHotkey = new IdeaHotkeyManager(ideaConfigStore, windowManager)

  registerAllHandlers({
    windowManager,
    configManager,
    floatingBallMgr,
    updateMgr,
    logService,
    workCollector,
    workRecordService: services.workRecordService,
      workTemplateCacheService: services.workTemplateCacheService,
    workCollectSyncService,
    userProfileService: services.userProfileService,
    savedCredentialsService: services.savedCredentialsService,
    accountChangeCleaner: services.accountChangeCleaner,
    agentService: services.agentService,
    llmClient: services.llmClient,
    workAnalysisService: services.workAnalysisService,
      notificationClient,
      agentRuntime,
      agentConfigStore,
      agentDbAdapter,
      ideaConfigStore,
      ideaRefiner,
      ideaHotkey,
      ideaCaptureWindow: windowManager.getIdeaCaptureWindow(),
      todosService: services.todosService,
      todoAiRunner: services.todoAiRunner,
  })

    // 代辦:啟動時把既有 pending 補跑一次 AI 分析
    services.todoAiRunner.enqueuePending()

    // 註冊靈感速記全域快捷鍵(失敗只 log,不影響啟動)
    ideaHotkey.register()

    // 註冊代辦錄入全域快捷鍵 Ctrl+/(docs/23;失敗只 log,不影響啟動)
    try {
        const okReg = globalShortcut.register(TODO_HOTKEY, () => {
            windowManager.createTodoCaptureWindow()
        })
        logger.info(okReg ? `代辦熱鍵已註冊:${TODO_HOTKEY}` : `代辦熱鍵註冊失敗(被佔用):${TODO_HOTKEY}`, 'todo.hotkey')
    } catch (err) {
        logger.warn(`代辦熱鍵註冊異常:${(err as Error).message}`, 'todo.hotkey')
    }

  // 配置 enabled=true 就立刻啟動(等渲染端送 token 來才會真的 tick)
  workCollector.start()

    // 每日學習建議(純桌面端):08:00 排程 + 啟動補生成。
    // 前置(模板綁定 / LLM 配置)在 scheduler 內部檢查,不滿足就靜默跳過。
    if (configManager) {
        dailyAdviceScheduler = new DailyAdviceScheduler(
            configManager, services.workRecordService, services.workTemplateCacheService,
            services.dailyAdviceService, services.llmClient, windowManager,
        )
        dailyAdviceScheduler.start()
    }
    registerDailyAdviceHandlers(dailyAdviceScheduler)

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
