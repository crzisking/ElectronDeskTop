/**
 * 工作採集紀錄表(work_records)。
 *
 * 每筆代表一次定時採集的結果 —— AI 分析後寫入,只存文字結果(category / description),
 * 不存原始截圖(端到端不落地政策)。
 *
 * 配套設計:[docs/11-工作採集設計.md](../../../../docs/11-工作採集設計.md)
 */

import {index, integer, real, sqliteTable, text} from 'drizzle-orm/sqlite-core'

/**
 * 工作分類 code:模板化後由管理員定義(例 BOM_MAINT / IT_REPAIR)+ 系統保留 OTHER。
 * 舊資料可能還是 coding/documenting/... 字串,前端對未識別 code 顯示「未分類」。
 * 用 string 不再用 union,因為 code 集合是動態的(管理員配)。
 */
export type WorkCategory = string

/** 採集時的活動狀態:active / idle。idle 紀錄 UI 永遠不顯示 */
export type ActivityState = 'active' | 'idle'

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

      /**
       * 採集時的活動狀態:
       *   - 'active':正常採集(AI 分析過)
       *   - 'idle':鍵鼠空閒,本地直接寫,不打 AI
       * UI / API 對使用者預設過濾 idle,管理員端可帶 includeIdle=true 查。
       */
      activityState: text('activityState').$type<ActivityState>().notNull().default('active'),
  },
  (table) => ({
    /** 流水線按時間倒序列;按日期區間查詢時走這條 */
    idxCapturedAt: index('idx_work_capturedAt').on(table.capturedAt),

      /** sync-daily 撈未同步紀錄走這條;synced=0 的列稀疏,效率好 */
      idxSynced: index('idx_work_records_synced').on(table.synced, table.capturedAt),

      /**
       * listByRange 同時過濾 capturedAt 區間 + activityState != 'idle' —— 單欄
       * idx_work_capturedAt 只能加速時間區間,activityState 的過濾走逐行檢查。
       * 時間線檢視預設 30 天,記錄到 10K+ 後可感卡頓。複合索引讓兩個條件都走 index。
       */
      idxCapturedAtActivityState: index('idx_work_capturedAt_activityState')
          .on(table.capturedAt, table.activityState),
  })
)

/** Drizzle 推導的 SELECT 行型別 */
export type WorkRecord = typeof workRecords.$inferSelect

/** Drizzle 推導的 INSERT 物件型別 */
export type NewWorkRecord = typeof workRecords.$inferInsert

/**
 * 業務分類模板的本地 cache(docs/23 Phase A — 模板移到 client)。
 *
 * 一個 user 同時只綁一個模板 → 固定 PK=1,每次 my-config 拉到新版直接 INSERT OR REPLACE。
 * detailJson 存整份 templateDetail JSON(name/items/examples/promptSnippet),
 * 本地不關心結構,反序列化用 → 結構變了也不用改 schema。
 */
export const workTemplateCache = sqliteTable('work_template_cache', {
    id: integer('id').primaryKey(),                       // 固定 1
    templateId: integer('templateId').notNull(),          // server TemplateId
    version: integer('version').notNull(),                // 對齊 server Version
    detailJson: text('detailJson').notNull(),             // JSON.stringify(templateDetail)
    updatedAt: integer('updatedAt').notNull(),
})

export type WorkTemplateCache = typeof workTemplateCache.$inferSelect
export type NewWorkTemplateCache = typeof workTemplateCache.$inferInsert
