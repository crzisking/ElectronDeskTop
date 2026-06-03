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
 *      → 用 zod schema(範例:agent.handlers.ts)
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
import {registerAgentHandlers} from './agent.handlers'
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
import type {AgentToolService} from '../services/agent-tool.service'
import type {WorkCollectorScheduler} from '../work-collect'
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
  userProfileService: UserProfileService | null
  savedCredentialsService: SavedCredentialsService | null
  accountChangeCleaner: AccountChangeCleaner | null
  agentService: AgentService | null
  agentToolService: AgentToolService
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
    userProfileService,
    savedCredentialsService,
    accountChangeCleaner,
    agentService,
    agentToolService,
  } = ctx

  registerWindowHandlers(windowManager, configManager)
  registerConfigHandlers(configManager)
  registerUpdateHandlers(updateMgr)
  registerLogHandlers()
  registerAuthHandlers()
  registerLogViewerHandlers(logService, windowManager)
  registerWorkCollectHandlers(workCollector, workRecordService, configManager, windowManager, workTemplateCacheService)
  registerFloatingBallHandlers(windowManager, configManager, floatingBallMgr)
  registerUserProfileHandlers(userProfileService, accountChangeCleaner)
  registerSavedCredentialsHandlers(savedCredentialsService)
  registerAgentHandlers(windowManager, agentService, agentToolService)

  logger.info('所有 IPC Handlers 註冊完成', 'IPC')
}
