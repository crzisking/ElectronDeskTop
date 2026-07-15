/**
 * 項目流程的本地 AI 能力 — 備忘建議 + 今日活動聚合(首頁儀表板用)。
 *
 * ⚠️ 匯報功能已清退,原本的「寫作教練」(generateReportAdvice)一併移除。
 * 從 ipc-handlers/project-flow.handlers.ts 搬出:handler 檔只負責通道註冊,
 * 業務與 prompt 集中在 services(對齊 daily-advice/scheduler 的擺放)。
 *
 * 設計原則:AI 是「教練」不是「代筆」— 不產出可直接提交的內容。
 */

import type {LlmClient} from '../llm'
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

/** 只要類別聚合時的便捷入口(AI prompt 用) */
export function aggregateTodayActivity(workRecordService: WorkRecordService): TodayActivityCategory[] {
    return summarizeTodayActivityFromService(workRecordService).categories
}

/** 聚合結果 → prompt 用文字 */
function activityText(categories: TodayActivityCategory[]): string {
    if (!categories.length) return '(今日尚無工作紀錄)'
    return categories
        .map((c) => `- ${c.category}: 約 ${c.minutes} 分鐘 (主要應用: ${c.apps.slice(0, 3).join(', ')})`)
        .join('\n')
}

// ─── AI 備忘建議:項目進度 + 現有待辦驅動(不看原始活動記錄) ──

/** renderer 傳來的上下文:我的節點(含截止日/狀態)+ 現有 pending 備忘 */
export interface MemoSuggestInput {
    nodes?: { projectName: string; title: string; status: string; deadline?: number | null; priority?: number }[]
    memos?: { title: string; priority: number; dueDate?: number | null }[]
}

export async function generateMemoSuggestions(
    llm: LlmClient | null,
    input: MemoSuggestInput,
): Promise<{ suggestions: object[] }> {
    if (!llm) throw new Error('LLM provider 尚未配置(請先到設定頁設定)')

    const today = new Date().toISOString().slice(0, 10)
    const fmtDate = (ms?: number | null) => (ms ? new Date(ms).toISOString().slice(0, 10) : '無')

    // 節點:只給未完成的;備忘:只給 pending(renderer 端已過濾,這裡再保險截斷)
    const nodeLines = (input.nodes ?? []).slice(0, 30)
        .map((n) => `- [${n.status}] ${n.projectName} / ${n.title}(截止: ${fmtDate(n.deadline)})`)
        .join('\n') || '(目前沒有指派給我的節點)'
    const memoLines = (input.memos ?? []).slice(0, 30)
        .map((m) => `- [優先級${m.priority}] ${m.title}(到期: ${fmtDate(m.dueDate)})`)
        .join('\n') || '(目前沒有進行中備忘)'

    const result = await llm.complete({
        responseFormat: 'json_object',
        temperature: 0.4,
        messages: [
            {
                role: 'system',
                content:
                    '你是工作助理。根據使用者的項目節點進度與現有待辦,建議值得新增的備忘錄。' +
                    '優先關注:即將到期或已逾期的節點、blocked 狀態的節點、高優先級但沒有跟進動作的待辦。' +
                    '不要重複已存在的備忘。回 JSON。',
            },
            {
                role: 'user',
                content:
                    `今天是 ${today}。\n\n我負責的項目節點:\n${nodeLines}\n\n現有進行中備忘:\n${memoLines}\n\n` +
                    `請建議最多 3 條新備忘(沒有值得提醒的就回空陣列)。\n` +
                    `回 JSON:{"suggestions":[{"title":"短標題","description":"具體說明","priority":1,"reasoning":"為什麼建議(關聯哪個節點/截止日)"}]}\n` +
                    `priority:0=低 1=中 2=高(逾期/即將到期給 2)。`,
            },
        ],
    })
    return safeParseJson<{ suggestions: object[] }>(result.content, 'suggestions')
}

/** 剝掉 LLM 回應可能包的 markdown 圍欄(daily-advice 也共用) */
export function stripJsonFence(raw: string): string {
    return raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim()
}

/** 剝圍欄 + parse;失敗給清楚錯誤訊息 */
export function safeParseJson<T>(raw: string, label: string): T {
    try {
        return JSON.parse(stripJsonFence(raw)) as T
    } catch (err) {
        throw new Error(`LLM ${label} 回應非合法 JSON: ${(err as Error).message}`)
    }
}
