/**
 * 工作分析 IPC handler — 薄轉發層:校驗 payload → 委派 work-analysis/ → 回傳。
 *
 * 業務編排全在 work-analysis/ 內(對齊 work-collect handler 的擺放):
 *   - 準備階段(預設 prompt)   → work-analysis/preparation.ts  prepareAnalysis()
 *   - 啟動 stream + 落庫 + push → work-analysis/runner.ts       startAnalysisStream()
 *   - 配額用量                  → work-analysis/runner.ts       todayQuota()
 *   - run slot / 中止           → work-analysis/run-context.ts  workAnalysisRunContext
 *
 * v2 流程(對應 UX 改造):Dialog 先 PREPARE 拿預設 system/user prompt(可改),使用者按「開始」
 * 後 START_STREAM 起 stream,delta 走 PUSH_STREAM,結束 PUSH_END 帶 reportId;中途走 INTERRUPT。
 */

import {ipcMain} from 'electron'
import {IpcChannels} from '../../shared/ipc-channels'
import {logger} from '../utils/logger'
import {isNonNegativeNumber, isPositiveInt} from '../utils/runtime-guards'
import type {ConfigManager} from '../config-manager'
import type {WorkRecordService} from '../db/features/work-collect/service'
import type {WorkTemplateCacheService} from '../db/features/work-collect/template-cache.service'
import type {WorkAnalysisService} from '../db/features/work-analysis/service'
import type {AgentService} from '../db/features/agent/service'
import type {WindowManager} from '../window-manager'
import type {LlmConfig} from '../../shared/types/llm.types'
import type {LlmClient} from '../services/llm'
import {
    prepareAnalysis,
    type ReportLocale,
    startAnalysisStream,
    type StartStreamOutcome,
    todayQuota,
    workAnalysisRunContext,
} from '../work-analysis'

const TAG = 'IPC:work-analysis'

// ─── Payload validators(IPC 協議翻譯,留在 handler)─────────────────

interface PreparePayload {
    rangeStart: number
    rangeEnd: number
    locale?: ReportLocale
}

function isPreparePayload(v: unknown): v is PreparePayload {
    if (typeof v !== 'object' || v === null) return false
    const p = v as Partial<PreparePayload>
    if (!isNonNegativeNumber(p.rangeStart)) return false
    if (!isNonNegativeNumber(p.rangeEnd)) return false
    if (p.rangeEnd <= p.rangeStart) return false
    if (p.locale !== undefined && p.locale !== 'zh-TW' && p.locale !== 'en') return false
    return true
}

interface StartStreamPayload {
    systemPrompt: string
    userContent: string
    rangeStart: number
    rangeEnd: number
    providerId?: string
    model?: string
    locale?: ReportLocale
}

function isStartStreamPayload(v: unknown): v is StartStreamPayload {
    if (typeof v !== 'object' || v === null) return false
    const p = v as Partial<StartStreamPayload>
    if (typeof p.systemPrompt !== 'string' || p.systemPrompt.length === 0) return false
    if (typeof p.userContent !== 'string' || p.userContent.length === 0) return false
    if (!isNonNegativeNumber(p.rangeStart)) return false
    if (!isNonNegativeNumber(p.rangeEnd)) return false
    if (p.rangeEnd <= p.rangeStart) return false
    if (p.providerId !== undefined && typeof p.providerId !== 'string') return false
    if (p.model !== undefined && typeof p.model !== 'string') return false
    if (p.locale !== undefined && p.locale !== 'zh-TW' && p.locale !== 'en') return false
    return true
}

// ─── Result types(對應 renderer-side AnalyzeResult 命名一致) ───

type PrepareResult =
    | {
    ok: true
    systemPrompt: string
    userContent: string
    recordCount: number
}
    | { ok: false; kind: 'no-records' | 'bad-payload' | 'db' }

type StartStreamResult = StartStreamOutcome | { ok: false; kind: 'bad-payload' }

// ─── Handler registration ────────────────────────────────────────

export function registerWorkAnalysisHandlers(
    workAnalysisService: WorkAnalysisService | null,
    workRecordService: WorkRecordService | null,
    templateCacheService: WorkTemplateCacheService | null,
    llmClient: LlmClient | null,
    configManager: ConfigManager,
    agentService: AgentService | null,
    windowManager: WindowManager,
): void {

    // ── 配額查詢 ──────────────────────────────────────────────────
    ipcMain.handle(
        IpcChannels.WORK_ANALYSIS_QUOTA,
        (): { used: number; limit: number } => todayQuota(workAnalysisService),
    )

    // ── 配置階段:拿預設 system + user prompt 給 Dialog 顯示 ────────
    ipcMain.handle(
        IpcChannels.WORK_ANALYSIS_PREPARE,
        (_e, payload: unknown): PrepareResult => {
            if (!isPreparePayload(payload)) {
                logger.warn('PREPARE payload 校驗失敗', TAG)
                return {ok: false, kind: 'bad-payload'}
            }
            return prepareAnalysis(
                {workRecordService, templateCacheService, configManager},
                {
                    rangeStart: payload.rangeStart,
                    rangeEnd: payload.rangeEnd,
                    locale: (payload.locale ?? 'zh-TW') as ReportLocale,
                },
            )
        },
    )

    // ── 啟動 stream(同步回 runId,後續 delta / end 走 push)──────────
    ipcMain.handle(
        IpcChannels.WORK_ANALYSIS_START_STREAM,
        (_e, payload: unknown): StartStreamResult => {
            if (!isStartStreamPayload(payload)) {
                return {ok: false, kind: 'bad-payload'}
            }
            return startAnalysisStream(
                {workAnalysisService, workRecordService, llmClient, windowManager},
                payload,
            )
        },
    )

    // ── 中止 stream ───────────────────────────────────────────────
    ipcMain.handle(
        IpcChannels.WORK_ANALYSIS_INTERRUPT,
        (_e, payload: unknown): boolean => {
            if (typeof payload !== 'object' || payload === null) return false
            const runId = (payload as { runId?: unknown }).runId
            if (typeof runId !== 'string') return false
            return workAnalysisRunContext.interrupt(runId)
        },
    )

    // ── 歷史列表 ──────────────────────────────────────────────────
    ipcMain.handle(
        IpcChannels.WORK_ANALYSIS_LIST,
        (_e, payload: unknown) => {
            if (!workAnalysisService) return []
            const limit = (typeof payload === 'object' && payload !== null
                && typeof (payload as { limit?: unknown }).limit === 'number'
                && isPositiveInt((payload as { limit: number }).limit))
                ? Math.min((payload as { limit: number }).limit, 200)
                : 50
            return workAnalysisService.listSummaries(limit)
        },
    )

    ipcMain.handle(
        IpcChannels.WORK_ANALYSIS_GET,
        (_e, payload: unknown) => {
            if (!workAnalysisService) return null
            if (typeof payload !== 'object' || payload === null) return null
            const id = (payload as { id?: unknown }).id
            if (typeof id !== 'string' || !id) return null
            return workAnalysisService.get(id)
        },
    )

    ipcMain.handle(
        IpcChannels.WORK_ANALYSIS_GET_LATEST,
        () => workAnalysisService?.getLatest() ?? null,
    )

    ipcMain.handle(
        IpcChannels.WORK_ANALYSIS_DELETE_ALL,
        () => workAnalysisService?.deleteAll() ?? {ok: false, deleted: 0},
    )

    ipcMain.handle(
        IpcChannels.WORK_ANALYSIS_TEST_CONNECTION,
        async (_e, payload: unknown) => {
            if (!llmClient) return {ok: false, error: 'LlmClient 未初始化', kind: 'config' as const}
            const providerId = (typeof payload === 'object' && payload !== null
                && typeof (payload as { providerId?: unknown }).providerId === 'string')
                ? (payload as { providerId: string }).providerId
                : undefined
            return await llmClient.testConnection(providerId)
        },
    )

    // ── Provider 配置 CRUD ────────────────────────────────────────
    ipcMain.handle(
        IpcChannels.WORK_ANALYSIS_READ_LLM_CONFIG,
        (): LlmConfig => agentService?.readConfig() ?? {},
    )

    ipcMain.handle(
        IpcChannels.WORK_ANALYSIS_WRITE_LLM_CONFIG,
        (_e, payload: unknown): boolean => {
            if (!agentService) return false
            if (typeof payload !== 'object' || payload === null) return false
            const cfg: LlmConfig = {}
            const p = payload as Partial<LlmConfig>
            if (Array.isArray(p.providers)) cfg.providers = p.providers
            if (typeof p.activeProviderId === 'string' || p.activeProviderId === null) {
                cfg.activeProviderId = p.activeProviderId ?? undefined
            }
            return agentService.writeConfig(cfg)
        },
    )
}
