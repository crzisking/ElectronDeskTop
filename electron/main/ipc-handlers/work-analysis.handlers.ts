/**
 * 工作分析 IPC handler — 編排「prepare(預設 prompt)→ stream(LLM)→ commit(落庫)」流程。
 *
 * v2 設計(對應 UX 改造):
 *   - 不再同步 await 完整分析 — 改成「啟動 invoke + 流式 push」
 *   - Dialog 先呼 PREPARE 拿預設 system/user prompt(可改)
 *   - 使用者按「開始」後呼 START_STREAM,main 起 stream,delta 走 PUSH_STREAM push
 *   - 結束時 PUSH_END 帶 reportId(已落庫)
 *   - 中途中止走 INTERRUPT
 *
 * 失敗策略:依舊回 union type,但 stream 階段的失敗透過 PUSH_END 推
 * (invoke 只負責「啟動成功 / 配置失敗 / 配額用完」這類同步判定)。
 */

import {type BrowserWindow, ipcMain} from 'electron'
import {randomUUID} from 'crypto'
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
import {LlmCallError, LlmConfigError} from '../services/llm'
import {
    buildMessagesFromText,
    parseAndValidate,
    prepareAnalysis,
    type ReportLocale,
    workAnalysisRunContext,
} from '../work-analysis'

const TAG = 'IPC:work-analysis'

/** 配額上限 — 集中常數,要調改一處 */
const DAILY_LIMIT = 5

// ─── Payload validators ──────────────────────────────────────────

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

type StartStreamResult =
    | { ok: true; runId: string }
    | { ok: false; kind: 'busy' | 'quota' | 'bad-payload' | 'db'; used?: number; limit?: number }

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
        (): { used: number; limit: number } => {
            const used = workAnalysisService?.todayCount() ?? 0
            return {used, limit: DAILY_LIMIT}
        },
    )

    // ── 配置階段:拿預設 system + user prompt 給 Dialog 顯示 ────────
    // handler 只做 IPC 協議翻譯:校驗 payload → 委派 work-analysis/preparation → 直接回傳
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

    // ── 啟動 stream ────────────────────────────────────────────────
    ipcMain.handle(
        IpcChannels.WORK_ANALYSIS_START_STREAM,
        async (_e, payload: unknown): Promise<StartStreamResult> => {
            if (!isStartStreamPayload(payload)) {
                return {ok: false, kind: 'bad-payload'}
            }
            if (!workAnalysisService || !llmClient) {
                return {ok: false, kind: 'db'}
            }

            // 配額檢查
            const used = workAnalysisService.todayCount()
            if (used >= DAILY_LIMIT) {
                return {ok: false, kind: 'quota', used, limit: DAILY_LIMIT}
            }

            // 取 slot
            const handle = workAnalysisRunContext.tryStart(payload.rangeStart, payload.rangeEnd)
            if (!handle) {
                return {ok: false, kind: 'busy'}
            }

            // **不 await** — 啟動 stream 後立刻回 runId,後續走 push
            void runStream(handle, payload, {
                workAnalysisService,
                workRecordService,
                llmClient,
                windowManager,
            })

            return {ok: true, runId: handle.runId}
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

// ─── runStream — 真正執行 stream 的非同步循環 ────────────────────

interface RunDeps {
    workAnalysisService: WorkAnalysisService
    workRecordService: WorkRecordService | null
    llmClient: LlmClient
    windowManager: WindowManager
}

async function runStream(
    handle: ReturnType<typeof workAnalysisRunContext.tryStart>,
    payload: StartStreamPayload,
    deps: RunDeps,
): Promise<void> {
    if (!handle) return

    const messages = buildMessagesFromText(payload.systemPrompt, payload.userContent)
    let finalText = ''
    let providerId = ''
    let providerLabel = ''
    let modelUsed = payload.model ?? ''
    let inputTokens: number | undefined
    let outputTokens: number | undefined

    try {
        for await (const event of deps.llmClient.stream({
            messages,
            providerId: payload.providerId,
            model: payload.model,
            temperature: 0.3,
            responseFormat: 'json_object',
            timeoutMs: 120_000,
            signal: handle.abort.signal,
        })) {
            if (event.kind === 'delta') {
                finalText += event.text
                pushStream(deps.windowManager, handle.runId, event.text)
            } else {
                // done
                modelUsed = event.model
                providerId = event.providerId
                providerLabel = event.providerLabel
                inputTokens = event.inputTokens
                outputTokens = event.outputTokens
            }
        }
    } catch (err) {
        // LlmConfigError / LlmCallError
        if (err instanceof LlmConfigError) {
            pushEnd(deps.windowManager, handle.runId, {ok: false, kind: 'no-provider'})
        } else if (err instanceof LlmCallError) {
            pushEnd(deps.windowManager, handle.runId, {ok: false, kind: 'llm-call', error: err.message})
        } else {
            logger.error('runStream 未預期錯誤', TAG, err)
            pushEnd(deps.windowManager, handle.runId, {ok: false, kind: 'llm-call', error: String(err)})
        }
        workAnalysisRunContext.end(handle.runId)
        return
    }

    // 中途被中止 — for-await 直接結束,沒走到 done,也沒 finalText 完整內容
    if (handle.abort.signal.aborted) {
        pushEnd(deps.windowManager, handle.runId, {ok: false, kind: 'aborted'})
        workAnalysisRunContext.end(handle.runId)
        return
    }

    // 正常結束 — 驗證 + 落庫
    const validation = parseAndValidate(finalText)
    const reportId = randomUUID()
    const written = deps.workAnalysisService.insert({
        id: reportId,
        rangeStart: payload.rangeStart,
        rangeEnd: payload.rangeEnd,
        recordCount: countRecords(deps.workRecordService, payload.rangeStart, payload.rangeEnd),
        providerId,
        providerLabel,
        modelUsed,
        reportJson: validation.ok ? JSON.stringify(validation.report) : finalText,
        inputTokens: inputTokens ?? null,
        outputTokens: outputTokens ?? null,
        createdAt: Date.now(),
    })

    if (!written) {
        pushEnd(deps.windowManager, handle.runId, {ok: false, kind: 'db'})
        workAnalysisRunContext.end(handle.runId)
        return
    }

    logger.info(
        `分析串流完成 runId=${handle.runId} reportId=${reportId} structured=${validation.ok} ` +
        `provider=${providerLabel} model=${modelUsed} tokens=${inputTokens ?? '?'}/${outputTokens ?? '?'}`,
        TAG,
    )

    pushEnd(deps.windowManager, handle.runId, {
        ok: true,
        structured: validation.ok,
        reportId,
        finalText,
    })
    workAnalysisRunContext.end(handle.runId)
}

function pushStream(winMgr: WindowManager, runId: string, delta: string): void {
    sendToAllWindows(winMgr, IpcChannels.PUSH_WORK_ANALYSIS_STREAM, {runId, delta})
}

function pushEnd(
    winMgr: WindowManager,
    runId: string,
    payload:
        | { ok: true; structured: boolean; reportId: string; finalText: string }
        | { ok: false; kind: 'no-provider' | 'llm-call' | 'db' | 'aborted'; error?: string },
): void {
    sendToAllWindows(winMgr, IpcChannels.PUSH_WORK_ANALYSIS_END, {runId, ...payload})
}

/**
 * 把 push 廣播到主窗 + LogViewer(若開著)— 對齊既有 broadcastToWorkRecordViewers
 * 但我們的 push 不必發給 LogViewer(它沒分析 UI),只給主窗。
 */
function sendToAllWindows(winMgr: WindowManager, channel: string, payload: unknown): void {
    const main = winMgr.getMainWindow() as BrowserWindow | null
    if (main && !main.isDestroyed()) main.webContents.send(channel, payload)
}

function countRecords(
    svc: WorkRecordService | null,
    rangeStart: number,
    rangeEnd: number,
): number {
    if (!svc) return 0
    return svc.listByRange(rangeStart, rangeEnd).length
}

