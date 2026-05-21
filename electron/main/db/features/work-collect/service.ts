/**
 * WorkRecordService:work_records 表的業務 API。
 *
 *  - insert():scheduler 拿到 AI 結果後寫入
 *  - listByRange():按日期區間查詢,給流水線 UI 用
 *
 * 容錯:寫入失敗只 console.error,不擴散到 caller(避免採集失敗炸業務)。
 */

import {and, asc, gte, lt, type SQL} from 'drizzle-orm'
import type {DatabaseManager} from '../../database-manager'
import {workRecords, type NewWorkRecord, type WorkRecord} from './schema'

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
}
