/**
 * LogService:logs 表的業務 API。
 *
 *  - write():logger / IPC handler 內部使用,每筆 INSERT 一條
 *  - query():預留給未來 dev-only 排查面板,本期不曝露給渲染端
 *  - cleanupOlderThan():啟動時清掉 N 天前舊紀錄(對齊 txt 檔的 14 天保留)
 *
 * 寫入容錯:
 *  - 內部 try/catch,失敗只 console.error,不擴散到 caller
 *  - 確保「寫日誌失敗 → 業務代碼掛掉」這條路不存在
 *
 * 設計文件:[docs/08-本地數據庫設計.md §11](../../../../docs/08-本地數據庫設計.md)
 */

import {and, desc, eq, gte, inArray, like, lt, sql, type SQL} from 'drizzle-orm'
import type {DatabaseManager} from '../../database-manager'
import {type LogLevel, type LogRow, logs, type LogSource} from './schema'

/** 查詢條件(LogViewer / dev 面板共用) */
export interface LogQueryParams {
  /** 單一等級或多等級 IN */
  level?: LogLevel | LogLevel[]
  source?: LogSource
  module?: string
  /** createdAt >= since (Unix ms) */
  since?: number
  /** createdAt <  until (Unix ms) */
  until?: number
  /** message LIKE %search% */
  search?: string
    /** 過濾單一 traceId — LogViewer「點 traceId」走這個 */
    traceId?: string
  /** 預設 200 */
  limit?: number
  /** 預設 0 */
  offset?: number
}

export class LogService {
  constructor(private readonly dbManager: DatabaseManager) {}

  /** 寫入一筆。失敗只 console.error,絕不擴散 */
  write(entry: {
    level: LogLevel
    source: LogSource
    module?: string
    message: string
    args?: unknown[]
      /** 跨模組關聯 ID(對齊 schema.ts traceId 欄位) */
      traceId?: string
      /** 結構化 metadata(對齊 schema.ts meta 欄位);durationMs 會自動合進來方便查詢 */
      meta?: Record<string, unknown>
      /** 操作耗時 ms。為了 SQL 查詢方便,合進 meta 而不單獨開欄(meta 不大,JSON 查詢可走) */
      durationMs?: number
  }): void {
    if (!this.dbManager.isReady()) return
    try {
      const {argsJson, errorStack} = serializeArgs(entry.args)
        // 合 durationMs 進 meta:單欄查詢方便,且避免多開一欄為了一個常用值
        const metaCombined = (entry.meta || entry.durationMs != null)
            ? {...(entry.meta ?? {}), ...(entry.durationMs != null ? {durationMs: entry.durationMs} : {})}
            : null
        const metaJson = metaCombined ? safeStringify(metaCombined) : null

      this.dbManager
        .getDb()
        .insert(logs)
        .values({
          createdAt: Date.now(),
          level: entry.level,
          source: entry.source,
          module: entry.module ?? null,
          message: entry.message,
          args: argsJson,
          errorStack,
            traceId: entry.traceId ?? null,
            meta: metaJson,
        })
        .run()
    } catch (err) {
      // 故意不走 logger:避免「寫日誌失敗 → 又寫日誌 → 又失敗」迴圈
      console.error('[LogService] DB 寫入失敗', err)
    }
  }

  /** 查詢日誌(給日誌查看器用)。按 createdAt 倒序,內建分頁。 */
  query(params: LogQueryParams): LogRow[] {
    if (!this.dbManager.isReady()) return []
    const conds = this.buildWhere(params)
    return this.dbManager
      .getDb()
      .select()
      .from(logs)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(logs.createdAt))
      .limit(params.limit ?? 200)
      .offset(params.offset ?? 0)
      .all()
  }

  /**
   * 用相同的 where 條件數總筆數,給日誌查看器分頁器顯示「總共 N 筆」用。
   * 跟 query() 共用相同的條件組裝邏輯。
   */
  count(params: LogQueryParams): number {
    if (!this.dbManager.isReady()) return 0
    const conds = this.buildWhere(params)
    const row = this.dbManager
      .getDb()
      .select({n: sql<number>`count(*)`})
      .from(logs)
      .where(conds.length ? and(...conds) : undefined)
      .get()
    return row?.n ?? 0
  }

  /** 抽出共用的 where 條件組裝,給 query / count 共用 */
  private buildWhere(params: LogQueryParams): SQL[] {
    const conds: SQL[] = []
    if (params.level) {
      conds.push(
        Array.isArray(params.level) ? inArray(logs.level, params.level) : eq(logs.level, params.level)
      )
    }
    if (params.source) conds.push(eq(logs.source, params.source))
    if (params.module) conds.push(eq(logs.module, params.module))
    if (params.since != null) conds.push(gte(logs.createdAt, params.since))
    if (params.until != null) conds.push(lt(logs.createdAt, params.until))
    if (params.search) conds.push(like(logs.message, `%${params.search}%`))
      if (params.traceId) conds.push(eq(logs.traceId, params.traceId))
    return conds
  }

    /**
     * 取 logs 表中出現過的所有 module 名稱(distinct,按出現頻率倒序)。
     *
     * 給 log-viewer 模組下拉用 —— 訊息一多手動輸入 module 名 typo 風險高,
     * 提供下拉避免猜「IPC:ball」還是「IPC:Ball」之類的問題。
     *
     * 為什麼按頻率排序:常用的模組(WorkCollector / WindowManager / IPC:* 等)
     * 出現次數遠多於偶發模組,排前面省選擇時間。
     *
     * 性能:logs 表規模 < 100K 行時直接 GROUP BY,無壓力。
     * 超大資料量可以改成只看最近 N 天,但目前無此需求。
     */
    listModules(): string[] {
        if (!this.dbManager.isReady()) return []
        const rows = this.dbManager
            .getDb()
            .select({module: logs.module, n: sql<number>`count(*)`})
            .from(logs)
            .where(sql`${logs.module}
            IS NOT NULL AND
            ${logs.module}
            !=
            ''`)
            .groupBy(logs.module)
            .orderBy(desc(sql`count(*)`))
            .all()
        return rows.map((r) => r.module!).filter((m): m is string => !!m)
    }

  /**
   * 刪除 N 天前的舊紀錄。
   * 啟動時呼叫一次即可;對齊 log-file-writer 的 RETENTION_DAYS=14。
   * @returns 被刪除的筆數
   */
  cleanupOlderThan(days: number): number {
    if (!this.dbManager.isReady()) return 0
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
    const result = this.dbManager.getDb().delete(logs).where(lt(logs.createdAt, cutoff)).run()
    return result.changes
  }
}

/**
 * 序列化 args:
 *  - Error → 抽出 {name, message, stack},stack 同時複製到 errorStack 欄位
 *  - 其他物件 / 原始型別 → JSON.stringify 整包
 *
 * 處理渲染端透過 IPC 來的 sanitized Error({__error__: true, name, message, stack})。
 */
function serializeArgs(args?: unknown[]): {argsJson: string | null; errorStack: string | null} {
  if (!args || args.length === 0) return {argsJson: null, errorStack: null}

  let errorStack: string | null = null
  const serialized = args.map((a) => {
    if (a instanceof Error) {
      errorStack = errorStack ?? a.stack ?? null
      return {name: a.name, message: a.message, stack: a.stack}
    }
    // 渲染端 sanitizeArg 包過的 Error
    if (a && typeof a === 'object' && (a as {__error__?: boolean}).__error__) {
      const e = a as {stack?: string}
      errorStack = errorStack ?? e.stack ?? null
    }
    return a
  })

  try {
    return {argsJson: JSON.stringify(serialized), errorStack}
  } catch {
    // 含循環引用等無法序列化的物件
    return {argsJson: '[unserializable]', errorStack}
  }
}

/** meta 用的安全 JSON.stringify,失敗 fallback 字串 */
function safeStringify(obj: unknown): string {
    try {
        return JSON.stringify(obj)
    } catch {
        return '[unserializable]'
    }
}
