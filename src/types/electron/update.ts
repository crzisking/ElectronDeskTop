/**
 * electronAPI.update 子介面 — 自動更新主動 API。
 *
 * 更新「狀態事件」透過 electronAPI.on(channel, cb) 訂閱,頻道:
 *   push:update-checking / push:update-available / push:update-not-available
 *   push:update-progress / push:update-downloaded / push:update-error
 *
 * 渲染層通常透過 useUpdate composable 統一封裝這些事件 + 對應 UI 提示,
 * 不直接呼叫此處的方法。
 */

export interface UpdateAPI {
    /** 手動觸發檢查更新(例如「關於」頁面的按鈕) */
    check: () => Promise<unknown>

    /** 手動觸發下載(autoDownload=false 時使用) */
    download: () => Promise<unknown>

    /** 用戶確認後立即重啟並安裝新版(NSIS oneClick 模式靜默完成) */
    quitAndInstall: () => Promise<void>
}
