import {describe, expect, it} from 'vitest'
import {
    formatClock,
    formatDate,
    formatDateTime,
    formatRelative,
    formatShortTime,
    formatStamp,
} from '@/shared/utils/format'

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

    it('formatDateTime 非空時走 toLocaleString(不是 "-",且反映輸入年份)', () => {
        expect(formatDateTime(ms)).not.toBe('-')
        // 不綁 locale 格式,但輸出必須包含輸入的年份(否則等於沒反映輸入)
        expect(formatDateTime(ms)).toContain('2026')
    })

    describe('formatRelative', () => {
        it('空值回空字串', () => {
            expect(formatRelative(null)).toBe('')
            expect(formatRelative(0)).toBe('')
        })
        it('分級:剛剛 / N分鐘前 / N小時前 / N天前', () => {
            const now = Date.now()
            expect(formatRelative(now - 30_000)).toBe('剛剛')       // <1 分
            expect(formatRelative(now - 5 * 60_000)).toBe('5 分鐘前')
            expect(formatRelative(now - 3 * 3600_000)).toBe('3 小時前')
            expect(formatRelative(now - 2 * 86400_000)).toBe('2 天前')
        })
        it('≥7 天回退成日期(YYYY-MM-DD)', () => {
            expect(formatRelative(ms)).toBe('2026-03-09') // 遠早於現在
        })
    })

    it('formatStamp 給「YYYYMMDD_HHmmss」且補零', () => {
        const t = new Date(2026, 2, 9, 8, 5, 3).getTime()
        expect(formatStamp(t)).toBe('20260309_080503')
    })
})
