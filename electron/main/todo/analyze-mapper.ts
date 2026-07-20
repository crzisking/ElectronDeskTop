/**
 * 代辦 AI 回應(後端 /api/todo/analyze)→ 本地 TodoPatch 的純映射。
 * 從 runner.ts 抽出:runner 依賴 electron / http 無法單測;本檔純函式、無副作用 → 可單測。
 * 是清洗後端 AI 輸出的信任邊界(欄位白名單 + 越界收斂 + 相對→絕對時間換算)。
 */
import type {TodoDueKind, TodoKind, TodoPatch, TodoPriority} from '../../shared/types/todo.types'

export interface AnalyzeResp {
    kind?: string
    title?: string
    priority?: number
    /** 絕對截止日 "yyyy-MM-dd" 或 null(後端依 today 錨點算好) */
    dueDate?: string | null
    time?: string | null
    category?: string
    owner?: string
    hint?: string
}

const KINDS = new Set(['task', 'bug', 'meeting', 'reminder'])

/** AnalyzeResp → 本地 patch(欄位校驗 + 時間換算) */
export function toPatch(res: AnalyzeResp, now: Date = new Date()): TodoPatch {
    const {dueAt, dueKind} = resolveDate(res.dueDate, res.time, now)
    const kind = (res.kind && KINDS.has(res.kind) ? res.kind : 'task') as TodoKind
    const priority = (res.priority === 0 || res.priority === 2 ? res.priority : 1) as TodoPriority
    const category = res.category === 'work' || res.category === 'life' ? res.category : ''

    const patch: TodoPatch = {
        kind,
        priority,
        category,
        owner: res.owner?.trim() || null,
        dueAt,
        dueKind,
        aiHint: res.hint?.trim() || null,
        aiState: 'done',
    }
    const title = res.title?.trim()
    if (title) patch.title = title
    return patch
}

/**
 * 後端給的絕對日期 "yyyy-MM-dd" + 時刻 → 截止 ms;無日期 → null。日期由 AI 依 today 錨點算好,這裡只組時刻。
 * `now` 可注入(預設當下)方便單測。
 */
export function resolveDate(
    dueDate: string | null | undefined,
    time: string | null | undefined,
    now: Date = new Date(),
): { dueAt: number | null; dueKind: TodoDueKind } {
    const m = dueDate ? /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(dueDate.trim()) : null
    if (!m) return {dueAt: null, dueKind: 'none'}

    const day = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
    const isToday = day.toDateString() === now.toDateString()
    const hm = time && /^\d{1,2}:\d{2}$/.test(time) ? time.split(':') : null
    day.setHours(hm ? Number(hm[0]) : (isToday ? 18 : 9), hm ? Number(hm[1]) : 0, 0, 0)

    // 本週結束 = 本週日 23:59:59.999。用 % 7 修正舊 bug:週日(getDay()=0)曾 +7 天,
    // 把整個下週都算進「本週」;現在週日當天 → endOfWeek = 今天。
    const endOfWeek = new Date(now)
    endOfWeek.setHours(23, 59, 59, 999)
    endOfWeek.setDate(now.getDate() + ((7 - now.getDay()) % 7))
    const dueKind: TodoDueKind = isToday ? 'today' : (day.getTime() <= endOfWeek.getTime() ? 'thisweek' : 'none')

    return {dueAt: day.getTime(), dueKind}
}
