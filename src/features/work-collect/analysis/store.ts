/**
 * 工作分析 Pinia store(v2,流式版)。
 *
 * 職責收斂(對齊 docs/19 的「Pinia 只放慢更新狀態」原則):
 *   - 慢更新:歷史報告列表 / 最新報告 / 配額狀態
 *   - 熱路徑 streaming 文字**不放這裡** — Dialog 內部走 StreamingController 直接動 DOM
 *
 * 對外 actions:
 *   - bootstrap():啟動 + dialog 開啟時呼,確保 latest / history / quota 是最新
 *   - refreshAfterStreamEnd(reportId):stream 結束後 dialog 通知 store 同步 DB
 *   - clearAllReports():逃生口
 *   - selectReport(id):切換顯示的「最新報告」(view-only)
 *
 * 不在這裡寫:
 *   - analyze 邏輯(streaming 流程整個移到 Dialog)
 *   - error 描述函式(各組件自行 i18n)
 */

import {defineStore} from 'pinia'
import {ref} from 'vue'
import {logger} from '@/shared/utils/logger'
import type {AnalysisReportRow, AnalysisReportSummary,} from '@/types/electron/work-analysis'

export const useWorkAnalysisStore = defineStore('workAnalysis', () => {
    /** 當前顯示在 AnalysisCard 的報告;預設為「最新」 */
    const latest = ref<AnalysisReportRow | null>(null)
    /** 歷史摘要列表(按時間倒序) */
    const history = ref<AnalysisReportSummary[]>([])
    /** 今日配額狀態 */
    const quota = ref<{ used: number; limit: number }>({used: 0, limit: 5})

    let initialized = false

    async function bootstrap(): Promise<void> {
        if (initialized) return
        initialized = true
        await Promise.all([refreshLatest(), refreshHistory(), refreshQuota()])
    }

    async function refreshLatest(): Promise<void> {
        try {
            latest.value = await window.electronAPI.workAnalysis.getLatest()
        } catch (err) {
            logger.warn('讀取最新報告失敗', 'WorkAnalysisStore', err)
        }
    }

    async function refreshHistory(): Promise<void> {
        try {
            history.value = await window.electronAPI.workAnalysis.list(50)
        } catch (err) {
            logger.warn('讀取歷史報告失敗', 'WorkAnalysisStore', err)
        }
    }

    async function refreshQuota(): Promise<void> {
        try {
            quota.value = await window.electronAPI.workAnalysis.quota()
        } catch (err) {
            logger.warn('讀取配額失敗', 'WorkAnalysisStore', err)
        }
    }

    /**
     * Dialog 內 stream 結束 + 報告落庫後呼這個 — 把新報告同步成 latest,並重抓 history/quota。
     * 不靠 push 通知 store(避免兩條更新路徑),統一由 Dialog 顯式觸發。
     */
    async function refreshAfterStreamEnd(): Promise<void> {
        await Promise.all([refreshLatest(), refreshHistory(), refreshQuota()])
    }

    /** 設置頁清除所有報告後 / 卡內手動清除 — 都呼這個讓 state 同步 */
    async function clearAllReports(): Promise<{ ok: boolean; deleted: number }> {
        const result = await window.electronAPI.workAnalysis.deleteAll()
        if (result.ok) {
            latest.value = null
            history.value = []
        }
        return result
    }

    /** 切到特定歷史報告 — 把 latest 暫時換成這份(只影響 UI 顯示,不動 DB) */
    async function selectReport(id: string): Promise<void> {
        const row = await window.electronAPI.workAnalysis.get(id)
        if (row) latest.value = row
    }

    return {
        latest,
        history,
        quota,
        bootstrap,
        refreshLatest,
        refreshHistory,
        refreshQuota,
        refreshAfterStreamEnd,
        clearAllReports,
        selectReport,
    }
})
