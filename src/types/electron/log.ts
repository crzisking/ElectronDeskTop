/**
 * electronAPI.log 子介面 — 渲染進程 → 主進程的日誌通道。
 *
 * 通常透過 src/shared/utils/logger.ts 封裝後使用,不直接呼叫此處。
 */

export interface LogAPI {
    /** 寫一條日誌到 <userData>/logs/renderer-YYYY-MM-DD.log + DB */
    write: (entry: {
        level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'
        message: string
        module?: string
        args?: unknown[]
        /** 跨模組關聯 ID(對齊 docs/08 §13) */
        traceId?: string
        /** 操作耗時(ms) */
        durationMs?: number
        /** 結構化 metadata */
        meta?: Record<string, unknown>
    }) => void

    /** 在 OS 檔案總管中打開日誌資料夾,返回路徑 */
    openFolder: () => Promise<{ ok: boolean; dir: string }>
}
