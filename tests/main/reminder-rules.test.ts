import {describe, expect, it} from 'vitest'
import {reminderState} from '@main/services/memo-reminder/reminder-rules'

const HOUR = 3600_000
const DAY = 86_400_000
const NOW = new Date(2026, 5, 11, 12, 0).getTime()

describe('reminderState(備忘該不該提醒、什麼狀態)', () => {
    it('沒到期日 → 不提醒', () => {
        expect(reminderState(null, NOW)).toBeNull()
        expect(reminderState(undefined, NOW)).toBeNull()
    })

    it('剛過期 → overdue(已逾期)', () => {
        expect(reminderState(NOW - HOUR, NOW)).toBe('overdue')
    })

    it('逾期正好 3 天(邊界內)→ 還提醒', () => {
        expect(reminderState(NOW - 3 * DAY, NOW)).toBe('overdue')
    })

    it('逾期超過 3 天 → 不再提醒(舊賬不吵)', () => {
        expect(reminderState(NOW - 3 * DAY - 1000, NOW)).toBeNull()
    })

    it('24 小時內到期 → due-soon(即將到期)', () => {
        expect(reminderState(NOW + HOUR, NOW)).toBe('due-soon')
        expect(reminderState(NOW + DAY, NOW)).toBe('due-soon')
    })

    it('還要超過 24 小時 → 還不用提醒', () => {
        expect(reminderState(NOW + DAY + 1000, NOW)).toBeNull()
        expect(reminderState(NOW + 5 * DAY, NOW)).toBeNull()
    })
})
