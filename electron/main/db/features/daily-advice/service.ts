/**
 * DailyAdviceService:daily_advice 表的業務 API。
 *
 * 失敗策略對齊 WorkAnalysisService:不拋例外,logger.error + 回 false / null / []。
 */

import {desc, eq} from 'drizzle-orm'
import {logger} from '../../../utils/logger'
import type {DatabaseManager} from '../../database-manager'
import {dailyAdvice, type DailyAdviceRow, type NewDailyAdvice} from './schema'

const TAG = 'DailyAdviceService'

export class DailyAdviceService {
    constructor(private readonly dbManager: DatabaseManager) {
    }

    /** 寫入(同 dateKey 先刪舊 — 重新生成 = 覆蓋當天) */
    upsert(entry: Omit<NewDailyAdvice, 'id'>): boolean {
        if (!this.dbManager.isReady()) {
            logger.error('upsert 失敗:DB 未就緒', TAG)
            return false
        }
        try {
            const db = this.dbManager.getDb()
            db.delete(dailyAdvice).where(eq(dailyAdvice.dateKey, entry.dateKey)).run()
            db.insert(dailyAdvice).values(entry).run()
            return true
        } catch (err) {
            logger.error('upsert 失敗', TAG, err)
            return false
        }
    }

    /** 取某天的建議(首頁顯示今日用) */
    getByDate(dateKey: string): DailyAdviceRow | null {
        if (!this.dbManager.isReady()) return null
        try {
            return this.dbManager.getDb()
                .select().from(dailyAdvice)
                .where(eq(dailyAdvice.dateKey, dateKey))
                .get() ?? null
        } catch (err) {
            logger.error('getByDate 失敗', TAG, err)
            return null
        }
    }

    /** 最近 N 天(倒序;首頁往回翻歷史用) */
    listRecent(limit = 7): DailyAdviceRow[] {
        if (!this.dbManager.isReady()) return []
        try {
            return this.dbManager.getDb()
                .select().from(dailyAdvice)
                .orderBy(desc(dailyAdvice.dateKey))
                .limit(limit)
                .all()
        } catch (err) {
            logger.error('listRecent 失敗', TAG, err)
            return []
        }
    }
}
