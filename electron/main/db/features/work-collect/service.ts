/**
 * WorkRecordService:work_records 表的業務 API。
 *
 * 修正 #10:關鍵寫入返回明確 `OpResult` 而非吞錯。
 *   - insert / markSynced 失敗時呼叫方能感知,而不是靜默降級
 *   - 失敗計數 + lastError 暴露,讓 UI 能顯示「待同步 / 失敗」狀態
 *
 * 容錯仍維持「不對 caller 拋例外」;只是把錯誤訊號從吞錯改成 OpResult。
 */

import {and, asc, eq, gte, inArray, lt, sql, type SQL} from 'drizzle-orm'
import type {DatabaseManager} from '../../database-manager'
import {type NewWorkRecord, type WorkRecord, workRecords} from './schema'

/** 寫入操作結果。ok=false 時 reason 必填 */
export type OpResult = { ok: true } | { ok: false; reason: string }

/** Service 健康狀態,UI 用來顯示「同步失敗」徽章 */
export interface WorkRecordHealth {
    /** 累計寫入失敗次數 */
    writeFailures: number
    /** 累計標記同步失敗次數 */
    markFailures: number
    /** 最近一次錯誤訊息(沒有則 null) */
    lastError: string | null
    /** 最近一次錯誤時間 Unix ms */
    lastErrorAt: number | null
}

export class WorkRecordService {
    private health: WorkRecordHealth = {
        writeFailures: 0,
        markFailures: 0,
        lastError: null,
        lastErrorAt: null,
    }

  constructor(private readonly dbManager: DatabaseManager) {}

    getHealth(): WorkRecordHealth {
        return {...this.health}
    }

    /**
     * 寫入一筆採集紀錄。失敗回 OpResult,不拋例外。
     * 之前簽名是 void —— 改回 OpResult 是 review 的修正點之一。
     */
    insert(entry: Omit<NewWorkRecord, 'id'>): OpResult {
        if (!this.dbManager.isReady()) {
            return this.recordFailure('write', 'DB not ready')
        }
    try {
      this.dbManager.getDb().insert(workRecords).values(entry).run()
        return {ok: true}
    } catch (err) {
        return this.recordFailure('write', errMsg(err))
    }
  }

  /**
   * 列出某時間區間內的紀錄,按時間正序(早 → 晚),適合畫流水線。
   * @param since createdAt >= since(Unix ms)
   * @param until createdAt <  until(Unix ms)
   */
  listByRange(since: number, until: number): WorkRecord[] {
    if (!this.dbManager.isReady()) return []
    const conds: SQL[] = [
      gte(workRecords.capturedAt, since),
      lt(workRecords.capturedAt, until),
    ]
    return this.dbManager
      .getDb()
      .select()
      .from(workRecords)
      .where(and(...conds))
      .orderBy(asc(workRecords.capturedAt))
      .all()
  }

  // ─── 集中化(docs/20):server sync 相關 ────────────────────────────

  /**
   * 列出尚未同步到 server 的紀錄(synced=0),最多 `limit` 筆,按 capturedAt 升序。
   */
  listUnsynced(limit: number = 200): WorkRecord[] {
    if (!this.dbManager.isReady()) return []
    return this.dbManager
        .getDb()
        .select()
        .from(workRecords)
        .where(eq(workRecords.synced, 0))
        .orderBy(asc(workRecords.capturedAt))
        .limit(limit)
        .all()
  }

  countUnsynced(): number {
    if (!this.dbManager.isReady()) return 0
    const row = this.dbManager
        .getDb()
        .select({n: sql<number>`count(*)`})
        .from(workRecords)
        .where(eq(workRecords.synced, 0))
        .get()
    return row?.n ?? 0
  }

  /**
   * 把 localId 清單標記為已同步。修正 #10:失敗回 OpResult,不再吞錯。
   * caller 看到 ok=false 時可以選擇下次 sync 重試前先 reload 本地紀錄。
   */
  markSynced(localIds: number[], syncedAt: number): OpResult {
      if (!this.dbManager.isReady()) {
          return this.recordFailure('mark', 'DB not ready')
      }
      if (localIds.length === 0) return {ok: true}
    try {
      this.dbManager
          .getDb()
          .update(workRecords)
          .set({synced: 1, syncedAt})
          .where(inArray(workRecords.id, localIds))
          .run()
        return {ok: true}
    } catch (err) {
        return this.recordFailure('mark', errMsg(err))
    }
  }

  /**
   * server backfill:把 server 端紀錄寫入本地;以 (capturedAt, screenshotHash) 粗略去重。
   * server 為權威源,因此一定標 synced=1。
   */
  upsertFromServer(rows: Omit<NewWorkRecord, 'id'>[]): number {
    if (!this.dbManager.isReady() || rows.length === 0) return 0
    let inserted = 0
    const db = this.dbManager.getDb()
    for (const r of rows) {
      try {
        const exists = db
            .select({id: workRecords.id})
            .from(workRecords)
            .where(
                and(
                    eq(workRecords.capturedAt, r.capturedAt as number),
                    r.screenshotHash
                        ? eq(workRecords.screenshotHash, r.screenshotHash as string)
                        : sql`${workRecords.screenshotHash}
                            IS NULL`,
                ),
            )
            .get()
        if (exists) continue
        db.insert(workRecords).values({...r, synced: 1, syncedAt: Date.now()}).run()
        inserted++
      } catch (err) {
          this.recordFailure('write', errMsg(err))
      }
    }
    return inserted
  }

    // ─── 內部:失敗紀錄 ────────────────────────────────────────────────

    private recordFailure(kind: 'write' | 'mark', reason: string): { ok: false; reason: string } {
        if (kind === 'write') this.health.writeFailures++
        else this.health.markFailures++
        this.health.lastError = reason
        this.health.lastErrorAt = Date.now()
        console.error(`[WorkRecordService] ${kind} 失敗: ${reason}`)
        return {ok: false, reason}
    }
}

function errMsg(err: unknown): string {
    if (err instanceof Error) return err.message
    return String(err)
}
