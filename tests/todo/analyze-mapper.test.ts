import {describe, expect, it} from 'vitest'
import {resolveDate, toPatch} from '@main/todo/analyze-mapper'

// 2026-07-15 = 週三(getDay=3);2026-07-18 週六;2026-07-19 週日;2026-07-20 下週一
const WED = new Date(2026, 6, 15, 12, 0, 0)
const SAT = new Date(2026, 6, 18, 12, 0, 0)
const SUN = new Date(2026, 6, 19, 12, 0, 0)

describe('resolveDate(絕對日期 + 時刻 → dueAt/dueKind)', () => {
    it('無日期 / 壞日期 → {null, none}', () => {
        expect(resolveDate(null, null, WED)).toEqual({dueAt: null, dueKind: 'none'})
        expect(resolveDate(undefined, '14:00', WED)).toEqual({dueAt: null, dueKind: 'none'})
        expect(resolveDate('not-a-date', null, WED)).toEqual({dueAt: null, dueKind: 'none'})
    })

    it('今天無時刻 → 18:00 + today', () => {
        const r = resolveDate('2026-07-15', null, WED)
        expect(r.dueKind).toBe('today')
        expect(r.dueAt).toBe(new Date(2026, 6, 15, 18, 0, 0, 0).getTime())
    })

    it('未來日無時刻 → 09:00', () => {
        const r = resolveDate('2026-07-18', null, WED)
        expect(r.dueAt).toBe(new Date(2026, 6, 18, 9, 0, 0, 0).getTime())
    })

    it('帶時刻 → 用該時刻;壞時刻 → 回退預設', () => {
        expect(resolveDate('2026-07-18', '14:30', WED).dueAt).toBe(new Date(2026, 6, 18, 14, 30, 0, 0).getTime())
        expect(resolveDate('2026-07-18', 'abc', WED).dueAt).toBe(new Date(2026, 6, 18, 9, 0, 0, 0).getTime())
    })

    it('週三:本週日(含)內 → thisweek,下週一 → none', () => {
        expect(resolveDate('2026-07-18', null, WED).dueKind).toBe('thisweek') // 週六
        expect(resolveDate('2026-07-19', null, WED).dueKind).toBe('thisweek') // 週日(週界)
        expect(resolveDate('2026-07-20', null, WED).dueKind).toBe('none')     // 下週一
    })

    it('週六:本週日 → thisweek,下週一 → none', () => {
        expect(resolveDate('2026-07-19', null, SAT).dueKind).toBe('thisweek')
        expect(resolveDate('2026-07-20', null, SAT).dueKind).toBe('none')
    })

    it('週日邊界回歸:endOfWeek=當天,下週一 → none(修正舊 +7 把下週算進本週的 bug)', () => {
        expect(resolveDate('2026-07-19', null, SUN).dueKind).toBe('today')
        expect(resolveDate('2026-07-20', null, SUN).dueKind).toBe('none')
    })
})

describe('toPatch(清洗後端 AI 輸出的信任邊界)', () => {
    it('kind 白名單:合法保留,非法/缺省 → task', () => {
        expect(toPatch({kind: 'bug'}, WED).kind).toBe('bug')
        expect(toPatch({kind: 'weird'}, WED).kind).toBe('task')
        expect(toPatch({}, WED).kind).toBe('task')
    })

    it('priority:0/2 保留,其餘(含 1 / 越界 / 缺省)→ 1', () => {
        expect(toPatch({priority: 0}, WED).priority).toBe(0)
        expect(toPatch({priority: 2}, WED).priority).toBe(2)
        expect(toPatch({priority: 1}, WED).priority).toBe(1)
        expect(toPatch({priority: 5}, WED).priority).toBe(1)
        expect(toPatch({}, WED).priority).toBe(1)
    })

    it('category 僅 work/life,其餘 → 空字串', () => {
        expect(toPatch({category: 'work'}, WED).category).toBe('work')
        expect(toPatch({category: 'life'}, WED).category).toBe('life')
        expect(toPatch({category: 'other'}, WED).category).toBe('')
        expect(toPatch({}, WED).category).toBe('')
    })

    it('owner/hint trim,空白 → null', () => {
        expect(toPatch({owner: '  Alice  ', hint: ' 快做 '}, WED).owner).toBe('Alice')
        expect(toPatch({owner: '  Alice  ', hint: ' 快做 '}, WED).aiHint).toBe('快做')
        expect(toPatch({owner: '   ', hint: ''}, WED).owner).toBeNull()
        expect(toPatch({}, WED).aiHint).toBeNull()
    })

    it('title 有值才寫入(trim);aiState 恆 done', () => {
        expect(toPatch({title: '  買菜 '}, WED).title).toBe('買菜')
        expect(toPatch({}, WED).title).toBeUndefined()
        expect(toPatch({}, WED).aiState).toBe('done')
    })
})
