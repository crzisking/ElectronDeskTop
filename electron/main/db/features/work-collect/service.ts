/**
 * WorkRecordService:work_records 表的業務 API。
 *
 *  - insert():scheduler 拿到 AI 結果後寫入
 *  - listByRange():按日期區間查詢,給流水線 UI 用
 *
 * 容錯:寫入失敗只 console.error,不擴散到 caller(避免採集失敗炸業務)。
 */

import {and, asc, eq, gte, inArray, lt, sql, type SQL} from 'drizzle-orm'
import type {DatabaseManager} from '../../database-manager'
import {type NewWorkRecord, type WorkRecord, workRecords} from './schema'

export class WorkRecordService {
  constructor(private readonly dbManager: DatabaseManager) {}

  /** 寫入一筆採集紀錄。失敗只 console.error,絕不拋例外 */
  insert(entry: Omit<NewWorkRecord, 'id'>): void {
    if (!this.dbManager.isReady()) return
    try {
      this.dbManager.getDb().insert(workRecords).values(entry).run()
    } catch (err) {
      console.error('[WorkRecordService] DB 寫入失敗', err)
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
   * 給 sync-daily 撈 unsynced 用;limit 控制單次上傳上限(後端限 200 條/批)。
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

  /** 未同步紀錄總數(safety net 判斷是否提前 sync 用) */
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
   * 把 localId 清單標記為已同步;syncedAt 由 server 回傳的 ms 寫入。
   * 失敗只 log,不擴散(下次 sync 仍會撈到再嘗試)。
   */
  markSynced(localIds: number[], syncedAt: number): void {
    if (!this.dbManager.isReady() || localIds.length === 0) return
    try {
      this.dbManager
          .getDb()
          .update(workRecords)
          .set({synced: 1, syncedAt})
          .where(inArray(workRecords.id, localIds))
          .run()
    } catch (err) {
      console.error('[WorkRecordService] markSynced 失敗', err)
    }
  }

  /**
   * server backfill:把 server 端紀錄寫入本地;以 (capturedAt, screenshotHash) 粗略去重。
   * server 為權威源,因此一定標 synced=1。
   * 跨機 / 重灌時呼叫,目前主流程不依賴。
   */
  upsertFromServer(rows: Omit<NewWorkRecord, 'id'>[]): number {
    if (!this.dbManager.isReady() || rows.length === 0) return 0
    let inserted = 0
    const db = this.dbManager.getDb()
    for (const r of rows) {
      try {
        // 嚴格 dedup 需要 server 的 LocalId 對齊本地 id,不同機器就對不上。
        // 此處只防同機重複 backfill:同 capturedAt + 同 hash 視為已有。
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
        console.error('[WorkRecordService] upsertFromServer 單筆失敗', err)
      }
    }
    return inserted
  }
}
