/**
 * DB 依賴服務的統一構造 —— 取代 index.ts 裡「模組 let 宣告 + new + catch null 重置」三處同步的樣板。
 * 加/減一個 DB 服務只改這裡(interface + 工廠各一行)+ 真正用它的地方,不再散在 index.ts 三處易漏。
 *
 * 構造順序即依賴順序:accountChangeCleaner ← workRecordService;llmClient ← agentService;
 * todoAiRunner ← todosService。DB 初始化失敗時 index.ts 不呼叫本工廠(bundle 為 null)。
 */
import type {DatabaseManager} from './db/database-manager'
import {WorkRecordService} from './db/features/work-collect/service'
import {WorkTemplateCacheService} from './db/features/work-collect/template-cache.service'
import {UserProfileService} from './db/features/user-profile/service'
import {SavedCredentialsService} from './db/features/saved-credentials/service'
import {AgentService} from './db/features/agent/service'
import {WorkAnalysisService} from './db/features/work-analysis/service'
import {DailyAdviceService} from './db/features/daily-advice/service'
import {TodosService} from './db/features/todos/service'
import {TodoAiRunner} from './todo/runner'
import {LlmClient} from './services/llm'
import {AccountChangeCleaner} from './db/account-change-cleaner'

export interface DbServices {
    workRecordService: WorkRecordService
    workTemplateCacheService: WorkTemplateCacheService
    userProfileService: UserProfileService
    savedCredentialsService: SavedCredentialsService
    accountChangeCleaner: AccountChangeCleaner
    agentService: AgentService
    llmClient: LlmClient
    workAnalysisService: WorkAnalysisService
    dailyAdviceService: DailyAdviceService
    todosService: TodosService
    todoAiRunner: TodoAiRunner
}

export function createDbServices(dbManager: DatabaseManager): DbServices {
    const workRecordService = new WorkRecordService(dbManager)
    const workTemplateCacheService = new WorkTemplateCacheService(dbManager)
    const userProfileService = new UserProfileService(dbManager)
    const savedCredentialsService = new SavedCredentialsService(dbManager)
    // cleaner 拿 workRecordService 是為了清表後 invalidate 內部 unsynced counter
    const accountChangeCleaner = new AccountChangeCleaner(dbManager, workRecordService)
    const agentService = new AgentService(dbManager)
    // LlmClient 依賴 agentService 拿 provider 配置(共用層,不要各自 new OpenAI)
    const llmClient = new LlmClient(agentService)
    const workAnalysisService = new WorkAnalysisService(dbManager)
    const dailyAdviceService = new DailyAdviceService(dbManager)
    const todosService = new TodosService(dbManager)
    const todoAiRunner = new TodoAiRunner(todosService)
    return {
        workRecordService, workTemplateCacheService, userProfileService, savedCredentialsService,
        accountChangeCleaner, agentService, llmClient, workAnalysisService, dailyAdviceService,
        todosService, todoAiRunner,
    }
}
