/**
 * daily_advice 表 — 每日學習建議(docs/每日 08:00 本地生成)。
 *
 * 一筆 row = 一天一份建議。dateKey UNIQUE:重新生成同一天會先刪舊的再插,
 * 永遠只保留當天最新一份(歷史天保留,首頁可往回翻)。
 *
 * 生成完全在桌面端:工種來自 workCollect 綁定的模板,內容由本地 LlmClient 產出,
 * 不經過後端。
 */

import {index, integer, sqliteTable, text} from 'drizzle-orm/sqlite-core'

export const dailyAdvice = sqliteTable(
    'daily_advice',
    {
        id: integer('id').primaryKey({autoIncrement: true}),

        /** 本地日期 'YYYY-MM-DD' — 一天一份,重生成覆蓋 */
        dateKey: text('dateKey').notNull().unique(),

        /**
         * 建議本體(LLM 回的結構化 JSON,JSON.stringify 後存)。
         * 結構:{summary, suggestions: [{title, detail, reason}]}
         */
        contentJson: text('contentJson').notNull(),

        /** 生成時綁定的工作模板名(=工種);模板換綁後歷史記錄仍可追溯 */
        templateName: text('templateName'),

        /** 實際使用的 model */
        modelUsed: text('modelUsed'),

        /** 參考的近 7 天工作紀錄筆數 */
        recordCount: integer('recordCount').notNull(),

        /** 生成時間(Unix ms) */
        createdAt: integer('createdAt').notNull(),
    },
    (table) => ({
        idxDateKey: index('idx_daily_advice_dateKey').on(table.dateKey),
    }),
)

export type DailyAdviceRow = typeof dailyAdvice.$inferSelect
export type NewDailyAdvice = typeof dailyAdvice.$inferInsert
