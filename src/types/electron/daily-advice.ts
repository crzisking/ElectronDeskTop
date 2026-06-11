/**
 * electronAPI.dailyAdvice 子介面 — 對齊 preload/bridges/daily-advice.bridge.ts。
 * 每日學習建議:純桌面端功能(工種模板 + 本地 LLM),不經後端。
 */

/** daily_advice 表 row(對齊 electron/main/db/features/daily-advice/schema.ts) */
export interface DailyAdviceRow {
    id: number
    /** 'YYYY-MM-DD' */
    dateKey: string
    /** JSON 字串:{summary, suggestions: [{title, detail, reason}]} */
    contentJson: string
    templateName: string | null
    modelUsed: string | null
    recordCount: number
    createdAt: number
}

/** contentJson 解析後的結構 */
export interface DailyAdviceContent {
    summary: string
    suggestions: {
        title: string
        detail: string
        reason: string
        /** 可直接拿去搜尋的關鍵字(舊資料可能沒有) */
        keywords?: string[]
    }[]
}

export interface DailyAdviceStatus {
    /** 是否已綁定工作採集模板(=知道工種) */
    templateBound: boolean
    templateName: string | null
    /** 是否已配置 LLM provider(ApiKey) */
    llmConfigured: boolean
    today: DailyAdviceRow | null
    recent: DailyAdviceRow[]
}

type Result<T> = { ok: true; data: T } | { ok: false; error: string }

export interface DailyAdviceAPI {
    status: () => Promise<Result<DailyAdviceStatus>>
    generate: () => Promise<Result<DailyAdviceRow>>
}
