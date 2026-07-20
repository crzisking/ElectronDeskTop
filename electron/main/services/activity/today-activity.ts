/**
 * 今日活動聚合(首頁熱力圖用)—— 純本地讀 work-collect,不打後端、不呼叫 LLM。
 * 前身 services/project-flow/ai-local.ts(功能退場後只剩這塊聚合)。
 */
import type {WorkRecordService} from '../../db/features/work-collect/service'
import type {TodayActivitySummary} from '../../../shared/types/activity.types'

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

/** 取今日 00:00 到此刻的紀錄再聚合(service 版;IPC handler 用) */
export function summarizeTodayActivityFromService(
    workRecordService: WorkRecordService,
    intervalMinutes = 5,
): TodayActivitySummary {
    const now = new Date()
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
    return summarizeTodayActivity(workRecordService.listByRange(startOfDay, Date.now(), false), intervalMinutes)
}
