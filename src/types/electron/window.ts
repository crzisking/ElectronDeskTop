/**
 * electronAPI.window 子介面 — 主窗口控制。
 */

export interface WindowAPI {
    /** 最小化主窗口到任務欄 */
    minimize: () => void

    /** 切換最大化 / 還原 */
    maximize: () => void

    /**
     * 關閉主窗口(隱藏 + 顯示浮球,不退出應用)。
     * 若需退出應用,使用 floatingBall 菜單的 quit-app action。
     */
    close: () => void

    /** 顯示主窗口並帶到前台 */
    show: () => void

    /** 隱藏主窗口 + 顯示浮球 */
    hide: () => void

    /** 查詢主窗口當前是否最大化 */
    isMaximized: () => Promise<boolean>

    /**
     * 在新 Electron 子窗口打開指定 URL。
     * 用於 openMode='electron-window' 的系統(不受 iframe X-Frame-Options 限制)。
     * @param url   系統訪問 URL
     * @param title 子窗口標題(顯示在任務欄)
     */
    openChild: (url: string, title: string) => Promise<void>
}
