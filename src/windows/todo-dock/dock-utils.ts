/**
 * 代辦 dock 的純顯示 / 判斷邏輯 —— 全部顯式收 now(ms),不讀時鐘,可單測(對齊 dashboard-utils)。
 * App.vue 只留薄包裝把 now.value 傳進來。
 */
import type {Todo} from '@shared/types/todo.types'

const pad = (n: number): string => (n < 10 ? '0' + n : String(n))

export type Urgency = 'overdue' | 'today' | 'later' | 'none'

/** 今天 23:59:59.999 的 ms */
export function endOfToday(now: number): number {
    const d = new Date(now)
    d.setHours(23, 59, 59, 999)
    return d.getTime()
}

/** 今天 00:00:00.000 的 ms */
export function startOfToday(now: number): number {
    const d = new Date(now)
    d.setHours(0, 0, 0, 0)
    return d.getTime()
}

/** 緊急度:無截止 none / 已過 overdue / 今天內 today / 之後 later */
export function urgency(t: Pick<Todo, 'dueAt'>, now: number): Urgency {
    if (t.dueAt == null) return 'none'
    if (t.dueAt < now) return 'overdue'
    if (t.dueAt <= endOfToday(now)) return 'today'
    return 'later'
}

/** 截止時刻顯示:今天 HH:mm / 明天 HH:mm / M/D HH:mm / 無截止 */
export function fmtTime(due: number | null, now: number): string {
    if (due == null) return '無截止'
    const d = new Date(due)
    const isSame = d.toDateString() === new Date(now).toDateString()
    const isTmr = d.toDateString() === new Date(now + 86400000).toDateString()
    const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`
    if (isSame) return `今天 ${hm}`
    if (isTmr) return `明天 ${hm}`
    return `${d.getMonth() + 1}/${d.getDate()} ${hm}`
}

export function priLabel(p: number): string {
    return p >= 2 ? '高' : '中'
}

/** 操作區日期標題:週X · M/D */
export function formatDateLabel(now: number): string {
    const d = new Date(now)
    const wk = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()]
    return `週${wk} · ${d.getMonth() + 1}/${d.getDate()}`
}

/** 就地編輯 chip 預設 → 絕對截止 ms(clear=null;today 18:00 / tomorrow 次日 09:00 / friday 本週五 18:00) */
export function presetDue(preset: string, now: number): number | null {
    if (preset === 'clear') return null
    const d = new Date(now)
    if (preset === 'tomorrow') {
        d.setDate(d.getDate() + 1)
        d.setHours(9, 0, 0, 0)
    } else if (preset === 'friday') {
        d.setDate(d.getDate() + ((5 - d.getDay() + 7) % 7))
        d.setHours(18, 0, 0, 0)
    } else {
        d.setHours(18, 0, 0, 0)
    }
    return d.getTime()
}

/** dueAt 是否落在 now+offset 天的那一天(給編輯 chip 高亮) */
export function sameDay(dueAt: number | null, offset: number, now: number): boolean {
    if (dueAt == null) return false
    const d = new Date(now)
    d.setDate(d.getDate() + offset)
    return new Date(dueAt).toDateString() === d.toDateString()
}

/** 漸進式完善:AI 已整理、仍無截止、沒提示過、且是「今天之前」建的舊任務 → 該輕提補時間 */
export function needsEnrich(
    t: Pick<Todo, 'aiState' | 'dueAt' | 'enrichPromptedAt' | 'createdAt'>,
    now: number,
): boolean {
    return t.aiState === 'done' && t.dueAt == null && !t.enrichPromptedAt && t.createdAt < startOfToday(now)
}
