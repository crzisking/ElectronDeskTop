/**
 * 今日活動聚合結果 —— 跨進程契約(main 聚合 work-collect → renderer 熱力圖)。
 * 前身 project-flow.types(功能退場後只剩這兩個)。時間 Unix ms。
 */

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
    /** 24 格:每小時的工作分鐘數(0-60) */
    hourly: number[]
}
