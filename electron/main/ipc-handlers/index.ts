/**
 * IPC Handler 註冊入口。
 *
 * 用於 electron/main/index.ts 在 app.whenReady() 與窗口創建後呼叫 registerAllHandlers()。
 *
 * 設計重點:
 *  - 簽名收進一個 `IpcHandlerContext` 物件,新增 feature 不需要動本函式的位置參數
 *  - 所有具體 handler 邏輯都委派給 child handler 檔(./*.handlers.ts)
 *  - 本檔只剩編排:把 context 拆解後分發給各 register* 函式
 *
 * ── Payload 校驗慣例 ────────────────────────────────────────────────
 * IPC 邊界 payload 是 `unknown`,必須 runtime 校驗。本專案兩種風格按 payload 複雜度選:
 *
 *   1. 複雜巢狀 / discriminated union / streaming chunk
 *      → 用 zod schema(例:streaming tool-call payload 之類)
 *
 *   2. 單一 primitive / 淺層 ≤ 3 欄物件
 *      → 用 utils/runtime-guards 的共用 guard(範例:work-collect.handlers.ts)
 *
 * 不要在新 handler 裡再造輪子寫一份 isPositiveInt;發現需要新 primitive guard
 * 就加到 utils/runtime-guards 共用。
 */

import {logger} from '../utils/logger'
import {registerWindowHandlers} from './window.handlers'
import {registerConfigHandlers} from './config.handlers'
import {registerUpdateHandlers} from './update.handlers'
import {registerLogHandlers} from './log.handlers'
import {registerAuthHandlers} from './auth.handlers'
import {registerLogViewerHandlers} from './log-viewer.handlers'
import {registerWorkCollectHandlers} from './work-collect.handlers'
import {registerFloatingBallHandlers} from './floating-ball.handlers'
import {registerUserProfileHandlers} from './user-profile.handlers'
import {registerSavedCredentialsHandlers} from './saved-credentials.handlers'
import {registerWorkAnalysisHandlers} from './work-analysis.handlers'
import {registerNotificationHandlers} from './notification.handlers'
import {registerProjectFlowHandlers} from './project-flow.handlers'
import {registerAgentHandlers} from './agent.handlers'
import {registerIdeaCaptureHandlers} from './idea-capture.handlers'
import type {AgentRuntime} from '../agent/runtime'
import type {IdeaConfigStore} from '../idea-capture/config-store'
import type {IdeaRefiner} from '../idea-capture/refiner'
import type {IdeaHotkeyManager} from '../idea-capture/hotkey-manager'
import type {IdeaCaptureWindow} from '../windows/idea-capture-window'
import type {AgentConfigStore} from '../agent/config-store'
import type {AgentDbAdapter} from '../agent/db-adapter'
import type {WindowManager} from '../window-manager'
import type {ConfigManager} from '../config-manager'
import type {FloatingBallManager} from '../floating-ball'
import type {UpdateManager} from '../update-manager'
import type {LogService} from '../db/features/logs/service'
import type {WorkRecordService} from '../db/features/work-collect/service'
import type {WorkTemplateCacheService} from '../db/features/work-collect/template-cache.service'
import type {UserProfileService} from '../db/features/user-profile/service'
import type {SavedCredentialsService} from '../db/features/saved-credentials/service'
import type {AgentService} from '../db/features/agent/service'
import type {LlmClient} from '../services/llm'
import type {WorkAnalysisService} from '../db/features/work-analysis/service'
import type {WorkCollectorScheduler, WorkCollectSyncService} from '../work-collect'
import type {NotificationClient} from '../services/notification-client'
import type {AccountChangeCleaner} from '../db/account-change-cleaner'

/**
 * IPC 註冊所需的所有依賴,集中成一個物件傳遞。
 *
 * 為什麼用 context object 而非位置參數:
 *  - 位置參數每加一個 manager 就要動 registerAllHandlers 的呼叫端
 *  - context object 可任意增減欄位,新增 feature 只在這個 interface 加屬性即可
 *  - main/index.ts 那邊直接 { windowManager, configManager, ... } 一次帶進來
 */
export interface IpcHandlerContext {
  windowManager: WindowManager
  configManager: ConfigManager
  floatingBallMgr: FloatingBallManager
  updateMgr: UpdateManager
  logService: LogService | null
  workCollector: WorkCollectorScheduler
  workRecordService: WorkRecordService | null
  workTemplateCacheService: WorkTemplateCacheService | null
  /** 集中化 sync 服務(取代渲染端的 syncDailyRecords 循環) */
  workCollectSyncService: WorkCollectSyncService | null
  userProfileService: UserProfileService | null
  savedCredentialsService: SavedCredentialsService | null
  accountChangeCleaner: AccountChangeCleaner | null
  /**
   * agent_configs / agent_messages 表的 service。Agent UI v1 已移除,
   * 此 service 現在作為「LLM provider 配置儲存」共用層,給 work-analysis 等功能讀
   * (透過 LlmClient 包裝);未來 Claude SDK Agent v2 也會復用同一份。
   */
  agentService: AgentService | null
  /**
   * LLM 共用呼叫層 — 後續 work-analysis 等需要打 OpenAI 兼容 API 的 handler 注入這個。
   * null = AgentService 未就緒(DB 沒起來),那時對應 handler 自己決定怎麼降級。
   */
  llmClient: LlmClient | null
  /** 工作分析報告儲存 */
  workAnalysisService: WorkAnalysisService | null
  /** 遠程通知 WebSocket 客戶端(docs/18) */
  notificationClient: NotificationClient
    /** Agent v2(docs/19):執行內核 + 配置 + 對話持久化;DB 未就緒時為 null */
    agentRuntime: AgentRuntime | null
    agentConfigStore: AgentConfigStore | null
    agentDbAdapter: AgentDbAdapter | null
    /** 靈感速記(docs/21):配置 / 後台完善佇列 / 熱鍵 / 速記小窗;DB 未就緒時為 null */
    ideaConfigStore: IdeaConfigStore | null
    ideaRefiner: IdeaRefiner | null
    ideaHotkey: IdeaHotkeyManager | null
    ideaCaptureWindow: IdeaCaptureWindow | null
}

/**
 * 註冊所有 IPC Handler。
 * 用於:main/index.ts 的 whenReady 回調,需在窗口創建後呼叫。
 */
export function registerAllHandlers(ctx: IpcHandlerContext): void {
  const {
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
      agentRuntime,
      agentConfigStore,
      agentDbAdapter,
      ideaConfigStore,
      ideaRefiner,
      ideaHotkey,
      ideaCaptureWindow,
  } = ctx

  registerWindowHandlers(windowManager, configManager)
  registerConfigHandlers(configManager)
  registerUpdateHandlers(updateMgr)
  registerLogHandlers()
  registerAuthHandlers()
  registerLogViewerHandlers(logService, windowManager)
  registerWorkCollectHandlers(workCollector, workRecordService, configManager, windowManager, workTemplateCacheService, workCollectSyncService)
  registerFloatingBallHandlers(windowManager, configManager, floatingBallMgr)
  registerUserProfileHandlers(userProfileService, accountChangeCleaner)
  registerSavedCredentialsHandlers(savedCredentialsService)
  registerWorkAnalysisHandlers(workAnalysisService, workRecordService, workTemplateCacheService, llmClient, configManager, agentService, windowManager)
  registerNotificationHandlers(notificationClient, configManager)
    // AI 本地端點(memo-suggest / report-generate)需要 LlmClient + workRecordService
    registerProjectFlowHandlers({llmClient, workRecordService})
    // Agent v2(docs/19);agentService 提供模型連線,windowManager 給資料夾選擇器當 parent
    registerAgentHandlers({
        runtime: agentRuntime,
        configStore: agentConfigStore,
        db: agentDbAdapter,
        agentService,
        windowManager
    })
    // 靈感速記(docs/21)
    registerIdeaCaptureHandlers({
        configStore: ideaConfigStore,
        refiner: ideaRefiner,
        hotkey: ideaHotkey,
        captureWindow: ideaCaptureWindow,
        windowManager,
    })

  logger.info('所有 IPC Handlers 註冊完成', 'IPC')
}
