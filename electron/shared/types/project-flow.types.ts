/**
 * 項目流程 — 跨進程型別契約。
 *
 * ⚠️ 專案/畫布/匯報/反饋/團隊/備忘錄等型別已隨對應功能全數清退(公測前瘦身;備忘錄由
 * 桌面代辦本地取代,見 docs/23)。只剩首頁儀表板用的「今日活動」聚合結果。
 * 時間統一 Unix ms。
 */

// ─── 今日活動聚合(work-collect 唯讀參考) ───────────────────

export interface TodayActivityCategory {
    category: string
    /** 估算分鐘數(採集間隔 5 分鐘 × 筆數) */
    minutes: number
    /** 主要應用(最多 5 個) */
    apps: string[]
}

/** 今日活動完整摘要 — 首頁熱力圖用 */
export interface TodayActivitySummary {
    categories: TodayActivityCategory[]
    /** 24 格:每小時的工作分鐘數(0-60),首頁熱力圖用 */
    hourly: number[]
}
