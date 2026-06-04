/**
 * electronAPI.workAnalysis 子介面 — 工作分析(AI 報告)。
 *
 * v2 設計(對應流式 dialog):
 *   - prepare       配置階段拿預設 prompt
 *   - startStream   啟動 stream,回 runId
 *   - interrupt     中止 stream
 *   - push:stream / end  走 electronAPI.on(channel, cb)
 */

import type {LlmConfig} from '@shared/types/llm.types'

/** AI 報告結構(對應 main 端 AnalysisReportPayload) */
export interface AnalysisReport {
    summary: string
    timeAllocation: {
        verdict: 'balanced' | 'skewed-high' | 'skewed-low'
        comment: string
    }
    highlights: Array<{ title: string; detail: string }>
    opportunities: Array<{
        title: string
        currentBehavior: string
        whyItMatters: string
        suggestion: string
    }>
    tomorrowSuggestion: string
}

/** DB row 完整投影(對應 work_analysis_reports schema) */
export interface AnalysisReportRow {
    id: string
    rangeStart: number
    rangeEnd: number
    recordCount: number
    providerId: string
    providerLabel: string
    modelUsed: string
    /** JSON.stringify(AnalysisReport) 或失敗時的 raw text */
    reportJson: string
    inputTokens: number | null
    outputTokens: number | null
    createdAt: number
}

/** 列表用摘要(無 reportJson) */
export interface AnalysisReportSummary {
    id: string
    rangeStart: number
    rangeEnd: number
    recordCount: number
    providerLabel: string
    modelUsed: string
    createdAt: number
}

/** prepare invoke 回應 */
export type PrepareResult =
    | {
    ok: true
    systemPrompt: string
    userContent: string
    recordCount: number
}
    | { ok: false; kind: 'no-records' | 'bad-payload' | 'db' }

/** startStream invoke 回應 */
export type StartStreamResult =
    | { ok: true; runId: string }
    | {
    ok: false
    kind: 'busy' | 'quota' | 'bad-payload' | 'db'
    used?: number
    limit?: number
}

/** PUSH_WORK_ANALYSIS_STREAM payload */
export interface StreamPushPayload {
    runId: string
    delta: string
}

/** PUSH_WORK_ANALYSIS_END payload */
export type EndPushPayload =
    | { runId: string; ok: true; structured: boolean; reportId: string; finalText: string }
    | { runId: string; ok: false; kind: 'no-provider' | 'llm-call' | 'db' | 'aborted'; error?: string }

/** testConnection 的 union 回應 */
export type TestConnectionResult =
    | { ok: true; model: string; providerLabel: string; latencyMs: number }
    | { ok: false; error: string; kind: 'config' | 'call' }

export interface WorkAnalysisAPI {
    /** 配置階段:拿預設 system / user prompt(使用者可改後再 startStream) */
    prepare: (payload: {
        rangeStart: number
        rangeEnd: number
        locale?: 'zh-TW' | 'en'
    }) => Promise<PrepareResult>

    /** 啟動串流分析;立即回 runId,後續走 push */
    startStream: (payload: {
        systemPrompt: string
        userContent: string
        rangeStart: number
        rangeEnd: number
        providerId?: string
        model?: string
        locale?: 'zh-TW' | 'en'
    }) => Promise<StartStreamResult>

    /** 中止指定 runId 的 stream */
    interrupt: (runId: string) => Promise<boolean>

    /** 歷史報告摘要列表 */
    list: (limit?: number) => Promise<AnalysisReportSummary[]>

    /** 取單份完整報告 */
    get: (id: string) => Promise<AnalysisReportRow | null>

    /** 取最新一份完整報告(初始載入用) */
    getLatest: () => Promise<AnalysisReportRow | null>

    /** 今日配額狀態 */
    quota: () => Promise<{ used: number; limit: number }>

    /** 清空所有報告(逃生口) */
    deleteAll: () => Promise<{ ok: boolean; deleted: number }>

    /** 測試 provider 連線(設置頁用) */
    testConnection: (providerId?: string) => Promise<TestConnectionResult>

    /** 讀目前的 LlmConfig(providers + activeProviderId) */
    readLlmConfig: () => Promise<LlmConfig>

    /** 寫部分 LlmConfig */
    writeLlmConfig: (partial: Partial<LlmConfig>) => Promise<boolean>
}
