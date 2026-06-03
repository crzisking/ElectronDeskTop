/**
 * 各 chart use-* composable 共用的型別 + 純資料計算 helper。
 *
 * 規則:這裡的函式不接 Vue ref / i18n,純資料變換。
 * 圖表 option 構建那層才走 useI18n + computed。
 */

import type {CallbackDataParams} from 'echarts/types/dist/shared'
import type {WorkCategory, WorkRecord} from '../types'

/**
 * ECharts tooltip formatter 的 params 結構。
 * 共用 ECharts 內建 `CallbackDataParams`,用聯合型別覆蓋「單值 / 多值陣列」。
 *
 * 注意:`axisValue` 在 ECharts 型別裡標為 string,實際 trigger:'axis' 都拿得到。
 */
export type TooltipParam = CallbackDataParams & {
    /** trigger:'axis' 才有,當前 axis 值(常為小時 / 日期字串) */
    axisValue?: string
    /**
     * value 形態因圖表而異:
     *  - bar/line:單一 number
     *  - heatmap:[xIndex, yIndex, value] 三元陣列
     */
    value: number | number[]
    /** trigger:'item' + pie/donut 才有 */
    percent?: number
}

export type CategoryCounts = Record<string, number>

/**
 * 從 records 推導當前出現過的 category,按出現頻次降序。
 * 模板化後 category 是動態 code,不再寫死 8 類。
 * 空資料時 legend 自然為空,不再顯示 coding/documenting 等過時固定項。
 */
export function deriveCategories(records: WorkRecord[]): WorkCategory[] {
    const counts = new Map<WorkCategory, number>()
    for (const r of records) {
        counts.set(r.category, (counts.get(r.category) ?? 0) + 1)
    }
    return [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([k]) => k)
}

export function countByCategory(records: WorkRecord[]): CategoryCounts {
    const counts: CategoryCounts = {}
    for (const r of records) counts[r.category] = (counts[r.category] ?? 0) + 1
    return counts
}

/** 今天 00:00:00 的時間戳 */
export function startOfToday(): number {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return d.getTime()
}

/**
 * 本週週一 00:00:00 的時間戳。
 * 用 ISO 週(週一為週首)而非「過去 7 天滾動窗口」,讓「本週檢視」對齊使用者直覺。
 */
export function startOfWeek(): number {
    const d = new Date()
    const offsetFromMon = (d.getDay() + 6) % 7 // Mon=0 ... Sun=6
    d.setDate(d.getDate() - offsetFromMon)
    d.setHours(0, 0, 0, 0)
    return d.getTime()
}

/** 按天分組紀錄(key 例 "5/19") */
export function groupRecordsByDay(records: WorkRecord[]): Map<string, WorkRecord[]> {
    const groups = new Map<string, WorkRecord[]>()
    for (const r of records) {
        const d = new Date(r.capturedAt)
        const key = `${d.getMonth() + 1}/${d.getDate()}`
        if (!groups.has(key)) groups.set(key, [])
        groups.get(key)!.push(r)
    }
    return groups
}

/** 按天統計總數 */
export function countByDay(records: WorkRecord[]): Map<string, number> {
    const groups = groupRecordsByDay(records)
    const result = new Map<string, number>()
    for (const [day, recs] of groups) {
        result.set(day, recs.length)
    }
    return result
}

/** 本週 Mon~Sun 七天標籤(跟 startOfWeek 一致) */
export function buildWeekDayLabels(): string[] {
    const monday = new Date(startOfWeek())
    const days: string[] = []
    for (let i = 0; i < 7; i++) {
        const d = new Date(monday)
        d.setDate(d.getDate() + i)
        days.push(`${d.getMonth() + 1}/${d.getDate()}`)
    }
    return days
}
