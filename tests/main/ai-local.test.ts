import {describe, expect, it} from 'vitest'
import {safeParseJson, stripJsonFence, summarizeTodayActivity} from '@main/services/project-flow/ai-local'

describe('stripJsonFence(剝掉模型加的 ```json 圍欄)', () => {
    it('剝 ```json 圍欄', () => {
        expect(stripJsonFence('```json\n{"a":1}\n```')).toBe('{"a":1}')
    })
    it('剝裸 ``` 圍欄', () => {
        expect(stripJsonFence('```\n{"a":1}\n```')).toBe('{"a":1}')
    })
    it('沒圍欄 → 原樣(去頭尾空白)', () => {
        expect(stripJsonFence('  {"a":1}  ')).toBe('{"a":1}')
    })
})

describe('safeParseJson(剝圍欄後解析,壞了拋清楚的錯)', () => {
    it('合法 JSON(帶圍欄)→ 解析成物件', () => {
        expect(safeParseJson('```json\n{"x":[1,2]}\n```')).toEqual({x: [1, 2]})
    })
    it('非法 JSON → 拋錯(不是回 null;呼叫端用 safeRun 接成 {ok:false})', () => {
        // 設計上故意 throw:回 null 會讓 AI 功能把 null 當正常數據用,錯誤被吞掉更難查
        expect(() => safeParseJson('not json')).toThrow(/非合法 JSON/)
    })
})

describe('summarizeTodayActivity(把今日記錄聚合成類別/小時)', () => {
    const t = (h: number) => new Date(2026, 5, 11, h).getTime()

    it('空記錄 → 空類別 + 24 格全 0', () => {
        const s = summarizeTodayActivity([])
        expect(s.categories).toEqual([])
        expect(s.hourly).toHaveLength(24)
        expect(s.hourly.every((m) => m === 0)).toBe(true)
    })

    it('類別按分鐘數降序,每筆記錄計 5 分鐘(預設間隔)', () => {
        const s = summarizeTodayActivity([
            {category: 'CODING', activeApp: 'code', capturedAt: t(9)},
            {category: 'CODING', activeApp: 'code', capturedAt: t(9)},
            {category: 'DOCS', activeApp: 'word', capturedAt: t(10)},
        ])
        expect(s.categories[0]).toEqual({category: 'CODING', minutes: 10, apps: ['code']})
        expect(s.categories[1]).toEqual({category: 'DOCS', minutes: 5, apps: ['word']})
    })

    it('hourly 按小時累加分鐘數', () => {
        const s = summarizeTodayActivity([
            {category: 'X', capturedAt: t(9)},
            {category: 'X', capturedAt: t(9)},
            {category: 'Y', capturedAt: t(14)},
        ])
        expect(s.hourly[9]).toBe(10)
        expect(s.hourly[14]).toBe(5)
        expect(s.hourly[10]).toBe(0)
    })

    it('同類別的 app 去重', () => {
        const s = summarizeTodayActivity([
            {category: 'X', activeApp: 'a', capturedAt: t(9)},
            {category: 'X', activeApp: 'a', capturedAt: t(9)},
            {category: 'X', activeApp: 'b', capturedAt: t(9)},
        ])
        expect(s.categories[0].apps.sort()).toEqual(['a', 'b'])
    })

    it('自訂採集間隔(10 分鐘)', () => {
        const s = summarizeTodayActivity([{category: 'X', capturedAt: t(9)}], 10)
        expect(s.categories[0].minutes).toBe(10)
        expect(s.hourly[9]).toBe(10)
    })
})
