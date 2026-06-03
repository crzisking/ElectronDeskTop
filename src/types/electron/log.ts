/**
 * electronAPI.log 子介面 — 渲染進程 → 主進程的日誌通道。
 *
 * 通常透過 src/shared/utils/logger.ts 封裝後使用,不直接呼叫此處。
 */

export interface LogAPI {
    /** 寫一條日誌到 <userData>/logs/renderer-YYYY-MM-DD.log */
    write: (entry: {
        level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'
        message: string
        module?: string
        args?: unknown[]
    }) => void

    /** 在 OS 檔案總管中打開日誌資料夾,返回路徑 */
    openFolder: () => Promise<{ ok: boolean; dir: string }>
}
