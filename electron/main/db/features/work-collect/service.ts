/**
 * WorkRecordService:work_records 表的業務 API。
 *
 * 寫入失敗回 OpResult(不拋例外),並累積健康計數供 UI 顯示「待同步 / 失敗」。
 */

import {and, asc, eq, gte, inArray, lt, sql, type SQL} from 'drizzle-orm'
import {logger} from '../../../utils/logger'
import type {DatabaseManager} from '../../database-manager'
import {type NewWorkRecord, type WorkRecord, workRecords} from './schema'

/** 寫入結果;ok=false 時 reason 必填 */
export type OpResult = { ok: true } | { ok: false; reason: string }

/** 健康計數,UI 顯示「同步失敗」徽章用 */
export interface WorkRecordHealth {
    writeFailures: number
    markFailures: number
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

    /** 寫入一筆採集紀錄。失敗回 OpResult,不拋例外。 */
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
   * 預設過濾掉 idle 紀錄(activityState='idle') — 使用者 UI 永不展示。
   * 同步上傳走 listUnsynced(),那個會帶 idle,不在這裡管。
   */
  listByRange(since: number, until: number, includeIdle = false): WorkRecord[] {
    if (!this.dbManager.isReady()) return []
    const conds: SQL[] = [
      gte(workRecords.capturedAt, since),
      lt(workRecords.capturedAt, until),
    ]
      if (!includeIdle) conds.push(sql`${workRecords.activityState}
      != 'idle'`)
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

    /** 標記 localIds 為已同步。失敗回 OpResult,caller 可保留 unsynced 待重試。 */
  markSynced(localIds: number[], syncedAt: number): OpResult {
        if (!this.dbManager.isReady()) return this.recordFailure('mark', 'DB not ready')
      if (localIds.length === 0) return {ok: true}
        try {
            this.dbManager.getDb()
                .update(workRecords)
                .set({synced: 1, syncedAt})
                .where(inArray(workRecords.id, localIds))
                .run()
            return {ok: true}
        } catch (err) {
            return this.recordFailure('mark', errMsg(err))
        }
  }

    /** server backfill:寫入本地,以 (capturedAt, screenshotHash) 粗略去重,一律標 synced=1 */
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

    private recordFailure(kind: 'write' | 'mark', reason: string): { ok: false; reason: string } {
        if (kind === 'write') this.health.writeFailures++
        else this.health.markFailures++
        this.health.lastError = reason
        this.health.lastErrorAt = Date.now()
        logger.error(`${kind} 失敗: ${reason}`, 'WorkRecordService')
        return {ok: false, reason}
    }
}

function errMsg(err: unknown): string {
    if (err instanceof Error) return err.message
    return String(err)
}
