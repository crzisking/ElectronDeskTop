import {describe, expect, it} from 'vitest'
import {
    GUIDE_BY_TYPE,
    guideFor,
    IDEA_TYPES,
    normalizeTags,
    parseTagQuery,
    softWarn,
    validateCreate,
} from '../../electron/shared/idea-capture/guided'

describe('guideFor', () => {
    it('四個類型都有引導文案', () => {
        for (const t of IDEA_TYPES) {
            const g = GUIDE_BY_TYPE[t]
            expect(g.label).toBeTruthy()
            expect(g.contentEg).toContain('例:')
            expect(g.sceneQ.endsWith('?')).toBe(true)
            expect(g.expectQ.endsWith('?')).toBe(true)
        }
    })
    it('問題隨類型切換(改進點 vs 問題不同)', () => {
        expect(guideFor('improve').sceneQ).toBe('現在的痛點是?')
        expect(guideFor('issue').sceneQ).toBe('怎麼發生的(能重現嗎)?')
        expect(guideFor('inspiration').expectQ).toBe('可以用在哪?')
    })
    it('未知類型退回 improve', () => {
        // @ts-expect-error 故意傳非法值測兜底
        expect(guideFor('nope')).toBe(GUIDE_BY_TYPE.improve)
    })
})

describe('validateCreate', () => {
    const base = {content: '一個想法', ideaType: 'improve' as const, visibility: 'private' as const}
    it('內容為空 → 擋', () => {
        expect(validateCreate({...base, content: '   '}).ok).toBe(false)
    })
    it('內容過長 → 擋', () => {
        expect(validateCreate({...base, content: 'x'.repeat(5001)}).ok).toBe(false)
    })
    it('類型 / 可見範圍不合法 → 擋', () => {
        // @ts-expect-error 非法類型
        expect(validateCreate({...base, ideaType: 'x'}).ok).toBe(false)
        // @ts-expect-error 非法可見範圍
        expect(validateCreate({...base, visibility: 'public'}).ok).toBe(false)
    })
    it('合法 → 過', () => {
        expect(validateCreate(base).ok).toBe(true)
    })
})

describe('softWarn', () => {
    it('場景空 → 提醒', () => {
        expect(softWarn({scene: ''})).toContain('場景')
        expect(softWarn({scene: undefined})).toBeTruthy()
    })
    it('場景有填 → 不提醒', () => {
        expect(softWarn({scene: '每次都要手動排查'})).toBeNull()
    })
})

describe('normalizeTags', () => {
    it('切分多種分隔符 + trim + 去空', () => {
        expect(normalizeTags('ERP, MES、 SQL ;UI')).toEqual(['ERP', 'MES', 'SQL', 'UI'])
    })
    it('大小寫不敏感去重(保序、保留首次原樣)', () => {
        expect(normalizeTags(['ERP', 'erp', 'Erp', 'MES'])).toEqual(['ERP', 'MES'])
    })
    it('空 / null → 空陣列', () => {
        expect(normalizeTags('')).toEqual([])
        expect(normalizeTags(null)).toEqual([])
        expect(normalizeTags(undefined)).toEqual([])
    })
})

describe('parseTagQuery', () => {
    it('tag: 前綴 → 抽出標籤', () => {
        expect(parseTagQuery('tag:ERP')).toBe('ERP')
        expect(parseTagQuery('  tag: MES ')).toBe('MES')
        expect(parseTagQuery('TAG:UI')).toBe('UI') // 大小寫不敏感
    })
    it('無前綴 / 空 → null', () => {
        expect(parseTagQuery('ERP')).toBeNull()
        expect(parseTagQuery('tag:')).toBeNull()
        expect(parseTagQuery('')).toBeNull()
    })
})
