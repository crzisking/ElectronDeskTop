/**
 * work_analysis_reports 表 — 工作分析功能產出的 AI 報告儲存。
 *
 * 一筆 row = 一次「分析範圍 + LLM 呼叫」的完整結果。
 *
 * 設計取捨:
 *   - **不冗餘存原始 records**:報告生成時 records 已聚合成 prompt payload 傳給 AI,
 *     原始 records 仍在 work_records 表,需要時用 rangeStart/rangeEnd 回查
 *   - **每天配額 5 次**:不另建計數器表,直接 COUNT (createdAt > today) 取
 *     換日後自然歸零,沒額外狀態
 *   - **不做時間清理**:對比歷史是核心價值,真要清走設置頁的「清除全部」逃生口
 *   - **modelUsed 留欄位**:同一份 provider 可能跑過不同 model,事後對比效果用
 *
 * 配套設計:docs(尚未撰寫,先此 schema 註解為準)
 */

import {index, integer, sqliteTable, text} from 'drizzle-orm/sqlite-core'

export const workAnalysisReports = sqliteTable(
    'work_analysis_reports',
    {
        /** uuid */
        id: text('id').primaryKey(),

        /** 分析範圍起點(Unix ms),含 */
        rangeStart: integer('rangeStart').notNull(),
        /** 分析範圍終點(Unix ms),不含 */
        rangeEnd: integer('rangeEnd').notNull(),

        /** 報告時段內 records 筆數 — 列表顯示「X 筆紀錄」用,免重撈 */
        recordCount: integer('recordCount').notNull(),

        /** 用的 provider id(對應 agent_configs.providers[].id) */
        providerId: text('providerId').notNull(),
        /** 用的 provider 顯示名 — provider 列表可能改名 / 刪除,落地當下凍結 */
        providerLabel: text('providerLabel').notNull(),
        /** 實際使用的 model */
        modelUsed: text('modelUsed').notNull(),

        /**
         * 報告本體(AI 回應的結構化 JSON,JSON.stringify 後存)。
         * 結構見 electron/main/work-analysis/schema.ts(AnalysisReportPayload)
         */
        reportJson: text('reportJson').notNull(),

        /** input / output tokens — provider 有回就存,無就 null */
        inputTokens: integer('inputTokens'),
        outputTokens: integer('outputTokens'),

        /** 報告產生時間(Unix ms) — 配額按本地時區歸零,查 today 也用這欄 */
        createdAt: integer('createdAt').notNull(),
    },
    (table) => ({
        /** 列表按時間倒序 + 取今日筆數 */
        idxCreatedAt: index('idx_work_analysis_createdAt').on(table.createdAt),
    }),
)

/** Drizzle SELECT row */
export type WorkAnalysisReportRow = typeof workAnalysisReports.$inferSelect

/** Drizzle INSERT 物件 */
export type NewWorkAnalysisReport = typeof workAnalysisReports.$inferInsert
