import {describe, expect, it} from 'vitest'
import {formatClock, formatDate, formatDateTime, formatShortTime} from '@/shared/utils/format'

// 固定一個本地時刻當基準:2026-03-09 08:05(用 new Date(y,m,d,h,mi) 構造,跟 toLocale* 同時區)
const ms = new Date(2026, 2, 9, 8, 5).getTime()

describe('format utils', () => {
    describe('空值', () => {
        it('formatDateTime 對 null/undefined/0 回 "-"', () => {
            expect(formatDateTime(null)).toBe('-')
            expect(formatDateTime(undefined)).toBe('-')
            expect(formatDateTime(0)).toBe('-')
        })
        it('formatShortTime / formatDate / formatClock 對空值回空字串', () => {
            expect(formatShortTime(null)).toBe('')
            expect(formatDate(undefined)).toBe('')
            expect(formatClock(0)).toBe('')
        })
    })

    it('formatShortTime 給「M/D HH:mm」且補零', () => {
        expect(formatShortTime(ms)).toBe('3/9 08:05')
    })

    it('formatDate 給「YYYY-MM-DD」且補零', () => {
        expect(formatDate(ms)).toBe('2026-03-09')
    })

    it('formatClock 給「HH:mm」且補零', () => {
        expect(formatClock(ms)).toBe('08:05')
    })

    it('formatDateTime 非空時走 toLocaleString(不是 "-")', () => {
        expect(formatDateTime(ms)).not.toBe('-')
        expect(formatDateTime(ms).length).toBeGreaterThan(0)
    })
})
