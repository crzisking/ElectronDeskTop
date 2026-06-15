import {describe, expect, it} from 'vitest'
import {distPercent, dueDays, dueLevel, heatStyle, paceLevel} from '@/views/Home/dashboard-utils'

const DAY = 86_400_000
// 固定「現在」= 2026-06-11(週四)中午 12 點,當所有相對時間的基準
const NOW = new Date(2026, 5, 11, 12, 0).getTime()

describe('paceLevel(工作節奏等級)', () => {
    it('沒工作 → 0(蓄勢待發)', () => {
        expect(paceLevel(0)).toBe(0)
        expect(paceLevel(-5)).toBe(0)
    })
    it('不到 1 小時 → 1(剛起步)', () => {
        expect(paceLevel(30)).toBe(1)
        expect(paceLevel(59)).toBe(1)
    })
    it('1~4 小時 → 2(漸入佳境)', () => {
        expect(paceLevel(60)).toBe(2)
        expect(paceLevel(239)).toBe(2)
    })
    it('4 小時以上 → 3(火力全開)', () => {
        expect(paceLevel(240)).toBe(3)
        expect(paceLevel(600)).toBe(3)
    })
})

describe('distPercent(類別佔比)', () => {
    it('正常佔比四捨五入', () => {
        expect(distPercent(30, 120)).toBe('25%')
        expect(distPercent(1, 3)).toBe('33%')
    })
    it('總數為 0 也不會崩(除零保護)', () => {
        expect(distPercent(0, 0)).toBe('0%')
    })
})

describe('heatStyle(熱力格顏色)', () => {
    it('0 分鐘 → 淡灰', () => {
        expect(heatStyle(0).background).toBe('#eef1f6')
    })
    it('60 分鐘 → 最深的藍(alpha 封頂 1.00)', () => {
        expect(heatStyle(60).background).toBe('rgba(48, 90, 158, 1.00)')
    })
    it('超過 60 分鐘不會溢出', () => {
        expect(heatStyle(999).background).toBe('rgba(48, 90, 158, 1.00)')
    })
})

describe('dueLevel(到期顏色等級)', () => {
    it('沒到期日 → none', () => {
        expect(dueLevel(null, NOW)).toBe('none')
        expect(dueLevel(undefined, NOW)).toBe('none')
    })
    it('已過期 → overdue', () => {
        expect(dueLevel(NOW - 1000, NOW)).toBe('overdue')
    })
    it('24 小時內到期 → soon', () => {
        expect(dueLevel(NOW + 1000, NOW)).toBe('soon')
        expect(dueLevel(NOW + DAY, NOW)).toBe('soon')
    })
    it('超過 24 小時 → normal', () => {
        expect(dueLevel(NOW + DAY + 1000, NOW)).toBe('normal')
    })
})

describe('dueDays(到期天數,按日曆日算)', () => {
    it('沒到期日 → null', () => {
        expect(dueDays(null, NOW)).toBeNull()
    })
    it('同一天稍晚到期 → 0(今天到期,不是 1 天後)', () => {
        // 今天傍晚 18 點到期,現在中午,仍算「今天到期」
        expect(dueDays(new Date(2026, 5, 11, 18, 0).getTime(), NOW)).toBe(0)
    })
    it('明天到期 → 1', () => {
        expect(dueDays(new Date(2026, 5, 12, 9, 0).getTime(), NOW)).toBe(1)
    })
    it('昨天到期 → -1(逾期一天)', () => {
        expect(dueDays(new Date(2026, 5, 10, 9, 0).getTime(), NOW)).toBe(-1)
    })
})
