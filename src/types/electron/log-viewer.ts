/**
 * electronAPI.logViewer 子介面 — 密碼保護的日誌查看器。
 */

export interface LogViewerAPI {
    /**
     * 驗證密碼。成功則主進程本 session 內記住已解鎖,
     * 後續 openWindow() 與子視窗內的 query 才會放行。
     * @returns true=密碼正確,false=密碼錯誤
     */
    unlock: (password: string) => Promise<boolean>

    /**
     * 開啟日誌查看器子視窗。必須先 unlock 成功;否則主進程會靜默拒絕。
     */
    openWindow: () => void
}
