/**
 * logs 表 schema:全應用日誌統一落地點(主進程 + 渲染進程雙寫進這張表)。
 *
 * 配套設計:[docs/08-本地數據庫設計.md §7-§8](../../../../docs/08-本地數據庫設計.md)
 *
 * 寫入規則摘要(完整見 08 §3.2):
 *  - 4 個 level (debug / info / warn / error) 全部寫進此表
 *  - 既有 .txt 檔仍只記 ERROR,跟此表並行存在
 */

import {index, integer, sqliteTable, text} from 'drizzle-orm/sqlite-core'

/** 日誌等級,跟 logger.{debug|info|warn|error} 對應 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

/** 日誌來源進程 */
export type LogSource = 'main' | 'renderer'

export const logs = sqliteTable(
  'logs',
  {
    id: integer('id').primaryKey({autoIncrement: true}),

    /** Unix ms,查詢主軸,必索引 */
    createdAt: integer('createdAt').notNull(),

    /** 4 個等級之一,字串存(人工查 DB 時可讀性比 enum int 好) */
    level: text('level').$type<LogLevel>().notNull(),

    /** 'main' | 'renderer';主進程強制覆寫渲染端傳的值,不信任客戶端 */
    source: text('source').$type<LogSource>().notNull(),

    /** logger 第 2 參數,部分呼叫不帶,可空 */
    module: text('module'),

    /** 主訊息字串 */
    message: text('message').notNull(),

    /** logger 第 3+ 參數 JSON.stringify;Error 物件展開為 {name, message, stack} */
    args: text('args'),

    /** args 內若含 Error,把 stack 拉出來方便 SQL 全文搜尋 */
    errorStack: text('errorStack'),

      /**
       * 關聯 ID(對齊 docs/08 §13 traceId 設計)。
       * 跨模組 / 跨進程的同一個業務操作共用一個 traceId,debug 時點一個 ID 過濾全部相關 log。
       * 例:登入流程的 auth.store → notification.ipc → notification.client 全用同個 traceId。
       * null = 此筆 log 不屬於任何 trace(獨立事件,例如啟動時的 init log)。
       */
      traceId: text('traceId'),

      /**
       * 結構化 metadata JSON。給 logger 第二參數傳 object 時的非保留欄位用。
       * 例 {durationMs: 1234, userName: 'X', recordCount: 50}。
       * 查詢可走 json_extract: WHERE json_extract(meta, '$.durationMs') > 1000。
       * 不該塞太大,單 row 上限 ~8KB(SQLite 軟限制,可調大但意義不大)。
       */
      meta: text('meta'),
  },
  (table) => ({
    /** 列表時間倒序用 */
    idxCreatedAt: index('idx_logs_createdAt').on(table.createdAt),
    /** 按 level 過濾(例如「只看 error」)用 */
    idxLevelCreated: index('idx_logs_level_createdAt').on(table.level, table.createdAt),
      /**
       * listModules() 走 WHERE module IS NOT NULL ... GROUP BY module — 沒索引就全表掃。
       * 日誌累積到 ~10K+ 後 LogViewer 的 module 下拉變慢,加這條把它變成索引掃描。
       */
      idxModule: index('idx_logs_module').on(table.module),
      /**
       * traceId 過濾:LogViewer 「點 traceId 看相關 log」走這條,sparse index(大多 null)
       * SQLite 預設不索引 null,儲存效率好。
       */
      idxTraceId: index('idx_logs_traceId').on(table.traceId),
  })
)

/** Drizzle 推導出的 SELECT 行型別 */
export type LogRow = typeof logs.$inferSelect

/** Drizzle 推導出的 INSERT 物件型別 */
export type NewLog = typeof logs.$inferInsert
