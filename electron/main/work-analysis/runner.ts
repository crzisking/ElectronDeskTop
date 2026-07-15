/**
 * 工作分析 stream runner — 「配額檢查 → 取 slot → LLM stream → 驗證 → 落庫 → push」的完整編排。
 *
 * 從 work-analysis.handlers.ts 抽出,讓 handler 只做 IPC 協議翻譯(校驗 payload → 委派 → 回傳),
 * 業務留在 work-analysis/ 內,對齊 preparation.ts 的擺放。
 *
 * 同步 / 非同步分界:
 *   - startAnalysisStream 同步判定(配額 / slot)→ 立刻回 {ok, runId} | {ok:false,...}
 *   - runStream 不被 await,delta 走 PUSH_STREAM、結束走 PUSH_END
 */

import {type BrowserWindow} from 'electron'
import {randomUUID} from 'crypto'
import {IpcChannels} from '../../shared/ipc-channels'
import {logger} from '../utils/logger'
import type {WorkRecordService} from '../db/features/work-collect/service'
import type {WorkAnalysisService} from '../db/features/work-analysis/service'
import type {WindowManager} from '../window-manager'
import type {LlmClient} from '../services/llm'
import {LlmCallError, LlmConfigError} from '../services/llm'
import {buildMessagesFromText, type ReportLocale} from './prompt-builder'
import {parseAndValidate} from './report-schema'
import {type RunHandle, workAnalysisRunContext} from './run-context'

const TAG = 'work-analysis.runner'

/** 配額上限 — 集中常數,要調改一處 */
export const DAILY_LIMIT = 5

export interface StartStreamInput {
    systemPrompt: string
    userContent: string
    rangeStart: number
    rangeEnd: number
    providerId?: string
    model?: string
    locale?: ReportLocale
}

export interface RunnerDeps {
    workAnalysisService: WorkAnalysisService | null
    workRecordService: WorkRecordService | null
    llmClient: LlmClient | null
    windowManager: WindowManager
}

export type StartStreamOutcome =
    | { ok: true; runId: string }
    | { ok: false; kind: 'busy' | 'quota' | 'db'; used?: number; limit?: number }

/** 今日配額用量(QUOTA 端點 + START_STREAM 前置檢查共用) */
export function todayQuota(workAnalysisService: WorkAnalysisService | null): { used: number; limit: number } {
    return {used: workAnalysisService?.todayCount() ?? 0, limit: DAILY_LIMIT}
}

/**
 * 啟動一次分析 stream。
 * 同步部分:配額檢查 + 取 slot;成功後 **不 await** runStream(後續走 push),立刻回 runId。
 */
export function startAnalysisStream(deps: RunnerDeps, input: StartStreamInput): StartStreamOutcome {
    if (!deps.workAnalysisService || !deps.llmClient) {
        return {ok: false, kind: 'db'}
    }

    const used = deps.workAnalysisService.todayCount()
    if (used >= DAILY_LIMIT) {
        return {ok: false, kind: 'quota', used, limit: DAILY_LIMIT}
    }

    const handle = workAnalysisRunContext.tryStart(input.rangeStart, input.rangeEnd)
    if (!handle) {
        return {ok: false, kind: 'busy'}
    }

    void runStream(handle, input, {
        workAnalysisService: deps.workAnalysisService,
        workRecordService: deps.workRecordService,
        llmClient: deps.llmClient,
        windowManager: deps.windowManager,
    })

    return {ok: true, runId: handle.runId}
}

// ─── runStream — 真正執行 stream 的非同步循環 ────────────────────

interface RunStreamDeps {
    workAnalysisService: WorkAnalysisService
    workRecordService: WorkRecordService | null
    llmClient: LlmClient
    windowManager: WindowManager
}

async function runStream(
    handle: RunHandle,
    payload: StartStreamInput,
    deps: RunStreamDeps,
): Promise<void> {
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
 * push 廣播 — 分析 UI 只在主窗,LogViewer 沒有分析面板,故只發主窗。
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
