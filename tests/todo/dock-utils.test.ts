import {describe, expect, it} from 'vitest'
import {
    formatDateLabel,
    fmtTime,
    needsEnrich,
    presetDue,
    priLabel,
    sameDay,
    urgency,
} from '@/windows/todo-dock/dock-utils'

// 2026-07-15 12:00 = 週三(getDay=3)
const WED = new Date(2026, 6, 15, 12, 0, 0).getTime()

describe('urgency(緊急度)', () => {
    it('無截止 none / 已過 overdue / 今天內 today / 之後 later', () => {
        expect(urgency({dueAt: null}, WED)).toBe('none')
        expect(urgency({dueAt: WED - 1000}, WED)).toBe('overdue')
        expect(urgency({dueAt: new Date(2026, 6, 15, 23, 0).getTime()}, WED)).toBe('today')
        expect(urgency({dueAt: new Date(2026, 6, 16, 9, 0).getTime()}, WED)).toBe('later')
    })
})

describe('fmtTime(截止時刻顯示)', () => {
    it('null → 無截止;今天 / 明天 / 其它日期前綴', () => {
        expect(fmtTime(null, WED)).toBe('無截止')
        expect(fmtTime(new Date(2026, 6, 15, 14, 30).getTime(), WED)).toBe('今天 14:30')
        expect(fmtTime(new Date(2026, 6, 16, 9, 0).getTime(), WED)).toBe('明天 09:00')
        expect(fmtTime(new Date(2026, 6, 20, 8, 5).getTime(), WED)).toBe('7/20 08:05')
    })
})

describe('priLabel', () => {
    it('≥2 高,其餘 中', () => {
        expect(priLabel(2)).toBe('高')
        expect(priLabel(1)).toBe('中')
        expect(priLabel(0)).toBe('中')
    })
})

describe('presetDue(chip 預設 → 絕對截止)', () => {
    it('clear=null;today 18:00 / tomorrow 次日 09:00 / friday 本週五 18:00', () => {
        expect(presetDue('clear', WED)).toBeNull()
        expect(presetDue('today', WED)).toBe(new Date(2026, 6, 15, 18, 0, 0, 0).getTime())
        expect(presetDue('tomorrow', WED)).toBe(new Date(2026, 6, 16, 9, 0, 0, 0).getTime())
        // 週三 → 本週五 = 07-17
        expect(presetDue('friday', WED)).toBe(new Date(2026, 6, 17, 18, 0, 0, 0).getTime())
    })
})

describe('sameDay(dueAt 是否落在 now+offset 那天)', () => {
    it('今天(offset 0)/ 明天(offset 1)', () => {
        expect(sameDay(new Date(2026, 6, 15, 8, 0).getTime(), 0, WED)).toBe(true)
        expect(sameDay(new Date(2026, 6, 16, 8, 0).getTime(), 1, WED)).toBe(true)
        expect(sameDay(new Date(2026, 6, 15, 8, 0).getTime(), 1, WED)).toBe(false)
        expect(sameDay(null, 0, WED)).toBe(false)
    })
})

describe('needsEnrich(漸進式完善提示閘)', () => {
    const base = {aiState: 'done' as const, dueAt: null, enrichPromptedAt: null, createdAt: new Date(2026, 6, 14, 9, 0).getTime()}

    it('AI 已整理 + 無截止 + 沒提示過 + 今天之前建 → true', () => {
        expect(needsEnrich(base, WED)).toBe(true)
    })
    it('今天才建 → false', () => {
        expect(needsEnrich({...base, createdAt: new Date(2026, 6, 15, 10, 0).getTime()}, WED)).toBe(false)
    })
    it('已有截止 / AI 未完成 / 已提示過 → false', () => {
        expect(needsEnrich({...base, dueAt: WED}, WED)).toBe(false)
        expect(needsEnrich({...base, aiState: 'pending'}, WED)).toBe(false)
        expect(needsEnrich({...base, enrichPromptedAt: WED}, WED)).toBe(false)
    })
})

describe('formatDateLabel', () => {
    it('週X · M/D', () => {
        expect(formatDateLabel(WED)).toBe('週三 · 7/15')
    })
})
