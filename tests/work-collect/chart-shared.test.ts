import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {
    buildWeekDayLabels,
    countByCategory,
    countByDay,
    deriveCategories,
    startOfToday,
    startOfWeek,
} from '@/features/work-collect/charts/_shared'
import {filterTodayRecords, filterWeekRecords} from '@/features/work-collect/charts/filter-records'
import type {WorkRecord} from '@/features/work-collect/types'

/** 造一筆最小工作記錄(只填測試關心的欄位) */
function rec(category: string, capturedAt: number): WorkRecord {
    return {category, capturedAt} as unknown as WorkRecord
}

describe('deriveCategories(取出現過的類別)', () => {
    it('去重且保留首次出現順序', () => {
        const records = [rec('A', 1), rec('B', 2), rec('A', 3)]
        expect(deriveCategories(records)).toEqual(['A', 'B'])
    })
    it('空陣列 → 空', () => {
        expect(deriveCategories([])).toEqual([])
    })
})

describe('countByCategory(按類別計數)', () => {
    it('各類別出現次數', () => {
        const records = [rec('A', 1), rec('A', 2), rec('B', 3)]
        expect(countByCategory(records)).toEqual({A: 2, B: 1})
    })
})

describe('countByDay(按天計數,回 Map,key 為 M/D)', () => {
    it('同一天的記錄累加', () => {
        const d1 = new Date(2026, 4, 19, 9).getTime()
        const d1b = new Date(2026, 4, 19, 15).getTime()
        const d2 = new Date(2026, 4, 20, 9).getTime()
        const m = countByDay([rec('A', d1), rec('A', d1b), rec('A', d2)])
        expect(m.get('5/19')).toBe(2)
        expect(m.get('5/20')).toBe(1)
    })
})

describe('時間區間(把現在凍結在 2026-06-11 週四 15:00)', () => {
    beforeEach(() => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date(2026, 5, 11, 15, 0))
    })
    afterEach(() => vi.useRealTimers())

    it('startOfToday 是今天 00:00', () => {
        expect(startOfToday()).toBe(new Date(2026, 5, 11, 0, 0, 0, 0).getTime())
    })

    it('startOfWeek 是本週一 00:00(週四往前推到週一 = 6/8)', () => {
        expect(startOfWeek()).toBe(new Date(2026, 5, 8, 0, 0, 0, 0).getTime())
    })

    it('buildWeekDayLabels 給週一到週日共 7 天', () => {
        const labels = buildWeekDayLabels()
        expect(labels).toHaveLength(7)
        expect(labels[0]).toBe('6/8')
        expect(labels[6]).toBe('6/14')
    })

    it('filterTodayRecords 只留今天的,昨天的濾掉', () => {
        const today = new Date(2026, 5, 11, 9).getTime()
        const yesterday = new Date(2026, 5, 10, 23).getTime()
        const got = filterTodayRecords([rec('A', today), rec('A', yesterday)])
        expect(got).toHaveLength(1)
        expect(got[0].capturedAt).toBe(today)
    })

    it('filterWeekRecords 只留本週的,上週的濾掉', () => {
        const thisWeek = new Date(2026, 5, 9, 9).getTime() // 週二,本週內
        const lastWeek = new Date(2026, 5, 5, 9).getTime() // 上週五
        const got = filterWeekRecords([rec('A', thisWeek), rec('A', lastWeek)])
        expect(got).toHaveLength(1)
        expect(got[0].capturedAt).toBe(thisWeek)
    })
})
