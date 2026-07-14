import {describe, expect, it} from 'vitest'
import {buildRefinePrompt, parseRefineResult} from '../../electron/shared/idea-capture/refine'

describe('buildRefinePrompt', () => {
    it('帶入三段 + 類型顯示名,要求 JSON 輸出', () => {
        const {system, user} = buildRefinePrompt({
            ideaType: 'improve', content: 'BOM 重複料號自動合併', scene: '手動排查很久', expectation: '自動提示',
        })
        expect(system).toContain('JSON')
        expect(system).toContain('不要編造')
        expect(user).toContain('改進點')
        expect(user).toContain('BOM 重複料號自動合併')
        expect(user).toContain('手動排查很久')
    })
    it('未填的段落標「未填」', () => {
        const {user} = buildRefinePrompt({ideaType: 'todo', content: '整理記錄'})
        expect(user).toContain('未填')
    })
})

describe('parseRefineResult', () => {
    it('純 JSON', () => {
        const r = parseRefineResult('{"title":"標題","polishedText":"內文","actionItems":["a","b"],"questions":["q"],"tags":["ERP"]}')
        expect(r).not.toBeNull()
        expect(r!.title).toBe('標題')
        expect(r!.polishedText).toBe('內文')
        expect(r!.actionItems).toEqual(['a', 'b'])
        expect(r!.aiQuestions).toEqual(['q'])
        expect(r!.tags).toEqual(['ERP'])
    })
    it('剝 markdown ```json 圍欄', () => {
        const raw = '好的:\n```json\n{"title":"T","actionItems":[],"questions":[],"tags":[]}\n```\n以上'
        const r = parseRefineResult(raw)
        expect(r!.title).toBe('T')
    })
    it('抓夾雜文字裡的第一個 JSON 物件', () => {
        const r = parseRefineResult('這是結果 {"polishedText":"x","actionItems":[],"questions":[],"tags":[]} 完成')
        expect(r!.polishedText).toBe('x')
    })
    it('缺欄位 → 陣列給空、字串給 undefined', () => {
        const r = parseRefineResult('{"polishedText":"only"}')
        expect(r!.title).toBeUndefined()
        expect(r!.actionItems).toEqual([])
        expect(r!.tags).toEqual([])
    })
    it('過濾陣列裡的非字串 / 空白', () => {
        const r = parseRefineResult('{"actionItems":["ok","  ",123,null],"questions":[],"tags":[]}')
        expect(r!.actionItems).toEqual(['ok'])
    })
    it('非法 / 空 → null', () => {
        expect(parseRefineResult('not json')).toBeNull()
        expect(parseRefineResult('')).toBeNull()
        expect(parseRefineResult(null)).toBeNull()
        expect(parseRefineResult('{bad json}')).toBeNull()
    })
})
