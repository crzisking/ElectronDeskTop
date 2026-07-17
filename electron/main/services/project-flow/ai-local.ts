/**
 * 項目流程的本地聚合 — 今日活動摘要(首頁儀表板用)+ LLM 回應圍欄剝除工具。
 *
 * ⚠️ 匯報/備忘建議等 AI 能力已隨對應功能清退(公測前瘦身);本檔只剩純本地的
 * work-collect 聚合(不打後端、不呼叫 LLM)與 daily-advice 共用的 stripJsonFence。
 */

import type {WorkRecordService} from '../../db/features/work-collect/service'

// ─── 今日活動聚合(首頁儀表板 + AI 建議共用) ─────────

export interface TodayActivityCategory {
    category: string
    minutes: number
    apps: string[]
}

/** 今日活動完整摘要 — 匯報編輯器參考面板 + 首頁熱力圖共用 */
export interface TodayActivitySummary {
    categories: TodayActivityCategory[]
    /** 24 格:每小時的工作分鐘數(0-60) */
    hourly: number[]
}

/** 聚合輸入的最小記錄形狀(純函式不綁完整 WorkRecord 型別,方便測試與複用) */
export interface ActivityRecordLike {
    category?: string | null
    activeApp?: string | null
    capturedAt: number
}

/**
 * 把一批工作紀錄聚合成「類別分鐘 + 24h 熱力」。純函式:不碰 DB、不讀 Date.now,只做聚合 → 可單測。
 *   - categories:類別 → 估算分鐘(筆數 × 採集間隔)+ 主要應用,按筆數降序
 *   - hourly:24 格,每格累加採集間隔(封頂 60)
 * 範圍過濾(今日)交給呼叫端(見 summarizeTodayActivityFromService)。
 *
 * @param records 已篩好範圍的紀錄
 * @param intervalMinutes 每筆代表的分鐘數(= 採集間隔,預設 5)
 */
export function summarizeTodayActivity(
    records: ActivityRecordLike[],
    intervalMinutes = 5,
): TodayActivitySummary {
    const byCategory = new Map<string, { apps: Set<string>; count: number }>()
    const hourly = new Array<number>(24).fill(0)
    for (const r of records) {
        const cat = r.category ?? 'unknown'
        const entry = byCategory.get(cat) ?? {apps: new Set<string>(), count: 0}
        entry.count++
        if (r.activeApp) entry.apps.add(r.activeApp)
        byCategory.set(cat, entry)

        const hour = new Date(r.capturedAt).getHours()
        hourly[hour] = Math.min(60, hourly[hour] + intervalMinutes)
    }

    const categories = Array.from(byCategory.entries())
        .sort((a, b) => b[1].count - a[1].count)
        .map(([category, info]) => ({
            category,
            minutes: info.count * intervalMinutes,
            apps: Array.from(info.apps).slice(0, 5),
        }))

    return {categories, hourly}
}

/** 取今日 00:00 到此刻的紀錄再聚合(service 版;IPC handler / report-advice 用) */
export function summarizeTodayActivityFromService(
    workRecordService: WorkRecordService,
    intervalMinutes = 5,
): TodayActivitySummary {
    const now = new Date()
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
    return summarizeTodayActivity(workRecordService.listByRange(startOfDay, Date.now(), false), intervalMinutes)
}

/** 剝掉 LLM 回應可能包的 markdown 圍欄(daily-advice 共用) */
export function stripJsonFence(raw: string): string {
    return raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim()
}
