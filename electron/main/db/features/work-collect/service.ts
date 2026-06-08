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

    /**
     * 未同步紀錄計數 in-memory cache。
     *
     * 為什麼維護:`countUnsynced()` 原本走 `SELECT count(*) WHERE synced=0`,
     * 被 `sync-coordinator.maybeSafetyNetSync()` 在 5 分鐘 tick 內熱呼叫。記錄累積後
     * 每次都掃 unsynced 列,惡性循環(網路差 → unsynced 越多 → count 越貴 → tick 越慢)。
     *
     * 維護規則:
     *   - null = 尚未初始化 / 被 invalidate;下次 countUnsynced() 重算一次,之後維護
     *   - insert 帶 synced=0(或省略,走預設 0)→ +1
     *   - markSynced 用 result.changes 精確 -N(WHERE 已限制 synced=0,changes 即真實 0→1 列數)
     *   - upsertFromServer 寫 synced=1,不動 counter
     *   - 任何繞過 service 直接寫表的場景(AccountChangeCleaner 跨表 delete)必須呼叫
     *     `invalidateUnsyncedCount()`,讓下次重算
     *
     * better-sqlite3 同步、單進程 → 無 race condition,不需鎖。
     */
    private unsyncedCount: number | null = null

    constructor(private readonly dbManager: DatabaseManager) {
    }

    /**
     * 讓下次 countUnsynced() 重新從 DB 撈一次真實值。
     * 給 AccountChangeCleaner 等「繞過 service 直接動表」的場景呼叫。
     */
    invalidateUnsyncedCount(): void {
        this.unsyncedCount = null
    }

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
            // 維護 counter:沒帶 synced 或 synced=0 視為未同步;失敗路徑不會走到這裡,所以不必補償
            if (this.unsyncedCount !== null && (entry.synced === undefined || entry.synced === 0)) {
                this.unsyncedCount++
            }
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
      // 首次或被 invalidate 後重新從 DB 算一次,之後靠 insert/markSynced 維護;
      // 不在 hot path 每次都 SELECT count(*) — 那是這個 optimization 的整個重點
      if (this.unsyncedCount === null) {
          const row = this.dbManager
              .getDb()
              .select({n: sql<number>`count(*)`})
              .from(workRecords)
              .where(eq(workRecords.synced, 0))
              .get()
          this.unsyncedCount = row?.n ?? 0
      }
      return this.unsyncedCount
  }

    /** 標記 localIds 為已同步。失敗回 OpResult,caller 可保留 unsynced 待重試。 */
  markSynced(localIds: number[], syncedAt: number): OpResult {
        if (!this.dbManager.isReady()) return this.recordFailure('mark', 'DB not ready')
      if (localIds.length === 0) return {ok: true}
        try {
            // WHERE 加 eq(synced, 0):
            //  1. 業務語義上本來就只想把「未同步」翻成「已同步」,不該動已 synced=1 的列
            //  2. result.changes 才會等於真實 0→1 列數,counter 才能精確 -N(不會 underflow)
            const result = this.dbManager.getDb()
                .update(workRecords)
                .set({synced: 1, syncedAt})
                .where(and(inArray(workRecords.id, localIds), eq(workRecords.synced, 0)))
                .run()
            if (this.unsyncedCount !== null) {
                this.unsyncedCount = Math.max(0, this.unsyncedCount - result.changes)
            }
            return {ok: true}
        } catch (err) {
            return this.recordFailure('mark', errMsg(err))
        }
  }

    /**
     * server backfill:寫入本地,以 (capturedAt, screenshotHash) 粗略去重,一律標 synced=1。
     *
     * 整批走一個 transaction —— 大規模首次同步(10K 列)從「N 次獨立 commit」收斂為單次 commit,
     * better-sqlite3 同步寫盤的瓶頸是 fsync,單 commit 比 10K commits 快 100× 以上。
     * SELECT 仍逐列做(idx_work_capturedAt 已索引,單筆 sub-ms),但全部在記憶體中累積,
     * 寫盤只在 transaction 結束時 fsync 一次。
     *
     * 失敗策略:單列 SELECT/INSERT 拋出 → recordFailure 累計失敗計數但**不**回滾整批
     * (drizzle 內 .transaction 內 throw 才會 rollback;我們手動捕獲就是讓壞列跳過、好列照寫,
     * 這跟原本逐列獨立 transaction 的語義保持一致)。
     */
  upsertFromServer(rows: Omit<NewWorkRecord, 'id'>[]): number {
    if (!this.dbManager.isReady() || rows.length === 0) return 0
    let inserted = 0
    const db = this.dbManager.getDb()
        const now = Date.now()
        db.transaction((tx) => {
            for (const r of rows) {
                try {
                    const exists = tx
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
                    tx.insert(workRecords).values({...r, synced: 1, syncedAt: now}).run()
                    inserted++
                } catch (err) {
                    this.recordFailure('write', errMsg(err))
                }
            }
        })
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
