/**
 * 日誌查看器 — 共用型別(跟主進程 LogService 對齊)。
 *
 * 為了不跨進程邊界 import,renderer 端重宣告;結構變動時兩邊同步。
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'
export type LogSource = 'main' | 'renderer'

export interface LogRow {
    id: number
    createdAt: number
    level: LogLevel
    source: LogSource
    module: string | null
    message: string
    args: string | null
    errorStack: string | null
    /** 跨模組關聯 ID(docs/08 §13);LogViewer 點一下過濾全部同 trace */
    traceId: string | null
    /** 結構化 metadata JSON;含 durationMs 等;展開時 pretty 顯示 */
    meta: string | null
}

export interface QueryResult {
    rows: LogRow[]
    total: number
}

export interface WorkHealth {
    pendingSync: number
    writeFailures: number
    markFailures: number
    lastError: string | null
    lastErrorAt: number | null
}

export interface LogViewerAPI {
    query: (params: Record<string, unknown>) => Promise<QueryResult>
    listModules: () => Promise<string[]>
    workHealth: () => Promise<WorkHealth>
}

declare global {
    interface Window {
        logViewerAPI: LogViewerAPI
    }
}
