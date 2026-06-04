/**
 * 工作分析 bridge — renderer ↔ main 的 invoke + push 介面。
 *
 * 設計(對應 dialog v2 流式版):
 *   - prepare:取預設 prompt(使用者後續可改)
 *   - startStream:啟動 stream,回 runId
 *   - interrupt:取消正在跑的 stream
 *   - 其餘 list/get/quota/deleteAll/testConnection/readLlmConfig/writeLlmConfig 同舊版
 *
 * 注意:push channel (PUSH_WORK_ANALYSIS_STREAM / END) 不在這個 bridge 內 — 走主 preload
 * 的 `electronAPI.on()` 訂閱(白名單已加)。本檔只暴露 invoke。
 */

import type {IpcRenderer} from 'electron'

export interface WorkAnalysisChannelMap {
    WORK_ANALYSIS_PREPARE: string
    WORK_ANALYSIS_START_STREAM: string
    WORK_ANALYSIS_INTERRUPT: string
    WORK_ANALYSIS_LIST: string
    WORK_ANALYSIS_GET: string
    WORK_ANALYSIS_GET_LATEST: string
    WORK_ANALYSIS_QUOTA: string
    WORK_ANALYSIS_DELETE_ALL: string
    WORK_ANALYSIS_TEST_CONNECTION: string
    WORK_ANALYSIS_READ_LLM_CONFIG: string
    WORK_ANALYSIS_WRITE_LLM_CONFIG: string
}

export function createWorkAnalysisBridge(ipc: IpcRenderer, ch: WorkAnalysisChannelMap) {
    return {
        prepare: (payload: {
            rangeStart: number
            rangeEnd: number
            locale?: 'zh-TW' | 'en'
        }) => ipc.invoke(ch.WORK_ANALYSIS_PREPARE, payload),

        startStream: (payload: {
            systemPrompt: string
            userContent: string
            rangeStart: number
            rangeEnd: number
            providerId?: string
            model?: string
            locale?: 'zh-TW' | 'en'
        }) => ipc.invoke(ch.WORK_ANALYSIS_START_STREAM, payload),

        interrupt: (runId: string) =>
            ipc.invoke(ch.WORK_ANALYSIS_INTERRUPT, {runId}) as Promise<boolean>,

        list: (limit?: number) => ipc.invoke(ch.WORK_ANALYSIS_LIST, {limit}),

        get: (id: string) => ipc.invoke(ch.WORK_ANALYSIS_GET, {id}),

        getLatest: () => ipc.invoke(ch.WORK_ANALYSIS_GET_LATEST),

        quota: () => ipc.invoke(ch.WORK_ANALYSIS_QUOTA),

        deleteAll: () => ipc.invoke(ch.WORK_ANALYSIS_DELETE_ALL),

        testConnection: (providerId?: string) =>
            ipc.invoke(ch.WORK_ANALYSIS_TEST_CONNECTION, {providerId}),

        readLlmConfig: () => ipc.invoke(ch.WORK_ANALYSIS_READ_LLM_CONFIG),

        writeLlmConfig: (partial: unknown) =>
            ipc.invoke(ch.WORK_ANALYSIS_WRITE_LLM_CONFIG, partial),
    }
}
