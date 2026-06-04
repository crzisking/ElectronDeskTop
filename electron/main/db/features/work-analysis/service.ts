/**
 * WorkAnalysisService:work_analysis_reports 表的業務 API。
 *
 * 對外職責:
 *  - insert():新報告落庫
 *  - listSummaries():歷史列表(只回顯示要的欄位,不含 reportJson 全文)
 *  - get():按 id 取單份完整報告
 *  - deleteAll():逃生口,設置頁「清除所有分析報告」用
 *  - todayCount():今日已產生報告數,給配額(5 次/天)邏輯讀
 *
 * 失敗策略:對齊 WorkRecordService — 不拋例外,logger.error + 回 false / null / []。
 */

import {and, desc, eq, gte, sql} from 'drizzle-orm'
import {logger} from '../../../utils/logger'
import type {DatabaseManager} from '../../database-manager'
import {type NewWorkAnalysisReport, type WorkAnalysisReportRow, workAnalysisReports} from './schema'

const TAG = 'WorkAnalysisService'

/**
 * 列表顯示用的摘要(不含 reportJson 全文,清單 query 省 IO + 序列化)。
 * 取單份完整內容走 get(id)。
 */
export interface ReportSummary {
    id: string
    rangeStart: number
    rangeEnd: number
    recordCount: number
    providerLabel: string
    modelUsed: string
    createdAt: number
}

export class WorkAnalysisService {
    constructor(private readonly dbManager: DatabaseManager) {
    }

    /**
     * 寫入新報告。返回 true 成功 / false 失敗。
     * caller 應該在呼叫前完成所有業務驗證(配額、payload 完整性),本方法只負責 IO。
     */
    insert(entry: NewWorkAnalysisReport): boolean {
        if (!this.dbManager.isReady()) {
            logger.error('insert 失敗:DB 未就緒', TAG)
            return false
        }
        try {
            this.dbManager.getDb().insert(workAnalysisReports).values(entry).run()
            return true
        } catch (err) {
            logger.error('insert 失敗', TAG, err)
            return false
        }
    }

    /**
     * 列出歷史報告摘要,createdAt DESC,最多 limit 筆(預設 50)。
     * 不撈 reportJson — 列表只顯示「時間 / 範圍 / 筆數 / provider」幾欄。
     */
    listSummaries(limit: number = 50): ReportSummary[] {
        if (!this.dbManager.isReady()) return []
        try {
            return this.dbManager.getDb()
                .select({
                    id: workAnalysisReports.id,
                    rangeStart: workAnalysisReports.rangeStart,
                    rangeEnd: workAnalysisReports.rangeEnd,
                    recordCount: workAnalysisReports.recordCount,
                    providerLabel: workAnalysisReports.providerLabel,
                    modelUsed: workAnalysisReports.modelUsed,
                    createdAt: workAnalysisReports.createdAt,
                })
                .from(workAnalysisReports)
                .orderBy(desc(workAnalysisReports.createdAt))
                .limit(limit)
                .all()
        } catch (err) {
            logger.error('listSummaries 失敗', TAG, err)
            return []
        }
    }

    /** 取單份完整報告(含 reportJson) */
    get(id: string): WorkAnalysisReportRow | null {
        if (!this.dbManager.isReady()) return null
        try {
            const row = this.dbManager.getDb()
                .select()
                .from(workAnalysisReports)
                .where(eq(workAnalysisReports.id, id))
                .get()
            return row ?? null
        } catch (err) {
            logger.error('get 失敗', TAG, err)
            return null
        }
    }

    /**
     * 取最新一份報告(列表頭一條)。
     * AnalysisCard 初始載入用 — 避免「listSummaries 取摘要 + get(id) 取完整」兩次 query。
     */
    getLatest(): WorkAnalysisReportRow | null {
        if (!this.dbManager.isReady()) return null
        try {
            const row = this.dbManager.getDb()
                .select()
                .from(workAnalysisReports)
                .orderBy(desc(workAnalysisReports.createdAt))
                .limit(1)
                .get()
            return row ?? null
        } catch (err) {
            logger.error('getLatest 失敗', TAG, err)
            return null
        }
    }

    /**
     * 今日已產生的報告數(本地時區 00:00 起算)。
     * 給配額(5 次/天)邏輯讀。0 點換日後自然歸零,不必另存計數器。
     */
    todayCount(): number {
        if (!this.dbManager.isReady()) return 0
        try {
            const startOfDay = startOfTodayLocal()
            const row = this.dbManager.getDb()
                .select({n: sql<number>`count(*)`})
                .from(workAnalysisReports)
                .where(and(gte(workAnalysisReports.createdAt, startOfDay)))
                .get()
            return row?.n ?? 0
        } catch (err) {
            logger.error('todayCount 失敗', TAG, err)
            return 0
        }
    }

    /**
     * 清空所有報告 — 設置頁逃生口。
     * 不分時間範圍、不按 provider 過濾,全清。
     * 失敗回 false,成功回實際刪除筆數(讓 UI 可顯示「已清除 N 筆」)。
     */
    deleteAll(): { ok: boolean; deleted: number } {
        if (!this.dbManager.isReady()) return {ok: false, deleted: 0}
        try {
            // better-sqlite3 的 run() 回 { changes, lastInsertRowid }
            const result = this.dbManager.getDb().delete(workAnalysisReports).run()
            return {ok: true, deleted: result.changes}
        } catch (err) {
            logger.error('deleteAll 失敗', TAG, err)
            return {ok: false, deleted: 0}
        }
    }
}

/**
 * 本地時區的今天 00:00:00.000 對應的 Unix ms。
 * 寫成獨立函式方便未來改時區策略時集中處理(例如改成北京時間)。
 */
function startOfTodayLocal(): number {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return d.getTime()
}
