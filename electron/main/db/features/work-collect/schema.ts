/**
 * 工作採集紀錄表(work_records)。
 *
 * 每筆代表一次定時採集的結果 —— AI 分析後寫入,只存文字結果(category / description),
 * 不存原始截圖(端到端不落地政策)。
 *
 * 配套設計:[docs/11-工作自動採集設計.md](../../../../docs/11-工作自動採集設計.md)
 */

import {index, integer, real, sqliteTable, text} from 'drizzle-orm/sqlite-core'

/** 工作類別,跟後端 WorkCategory 列舉一致 */
export type WorkCategory =
  | 'coding' | 'documenting' | 'browsing' | 'communicating'
  | 'meeting' | 'designing' | 'idle' | 'other'

export const workRecords = sqliteTable(
  'work_records',
  {
    id: integer('id').primaryKey({autoIncrement: true}),

    /** Unix ms,採集時間,主查詢索引 */
    capturedAt: integer('capturedAt').notNull(),

    /** 前台應用名,例 "Code.exe" */
    activeApp: text('activeApp'),

    /** 前台視窗標題 */
    activeWindowTitle: text('activeWindowTitle'),

    /** AI 分析的工作類別 */
    category: text('category').$type<WorkCategory>().notNull(),

    /** AI 生成的描述 */
    description: text('description').notNull(),

    /** 模型信心 0-1 */
    confidence: real('confidence'),

      /** 截圖 dHash(16 hex,8x8 灰階差分),供閒置比對 + 事後 debug */
      screenshotHash: text('screenshotHash'),

      /** AI 為什麼把這張畫面歸到此分類的理由(可空,前期紀錄沒有此欄位) */
      reason: text('reason'),

      /**
       * 是否已同步到 server(集中化設計,docs/20):
       *   0 = 未同步;1 = 已同步
       * 預設 0,sync-daily 成功後寫 1。離線時繼續 insert 0,網路恢復補傳。
       * 既有歷史紀錄遷移後預設 0,首次啟動會被 safety net 一次性 batch upload。
       */
      synced: integer('synced').notNull().default(0),

      /** server 端 SyncedAt(Unix ms);未同步為 null */
      syncedAt: integer('syncedAt'),
  },
  (table) => ({
    /** 流水線按時間倒序列;按日期區間查詢時走這條 */
    idxCapturedAt: index('idx_work_capturedAt').on(table.capturedAt),

      /** sync-daily 撈未同步紀錄走這條;synced=0 的列稀疏,效率好 */
      idxSynced: index('idx_work_records_synced').on(table.synced, table.capturedAt),
  })
)

/** Drizzle 推導的 SELECT 行型別 */
export type WorkRecord = typeof workRecords.$inferSelect

/** Drizzle 推導的 INSERT 物件型別 */
export type NewWorkRecord = typeof workRecords.$inferInsert
