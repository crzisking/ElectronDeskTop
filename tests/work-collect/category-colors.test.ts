import {describe, expect, it} from 'vitest'
import {getCategoryColor, getCategoryLabel} from '@/features/work-collect/category-colors'
import type {WorkCategory} from '@/features/work-collect/types'

const cat = (s: string) => s as WorkCategory

describe('getCategoryColor', () => {
    it('空 / OTHER 給灰', () => {
        expect(getCategoryColor(cat(''))).toBe('#B1B3B8')
        expect(getCategoryColor(cat('OTHER'))).toBe('#B1B3B8')
    })
    it('legacy 8 類沿用固定配色', () => {
        expect(getCategoryColor(cat('coding'))).toBe('#67C23A')
        expect(getCategoryColor(cat('meeting'))).toBe('#F56C6C')
    })
    it('新 code 走 palette,且同 code 跨呼叫穩定(hash 確定性)', () => {
        const c1 = getCategoryColor(cat('BOM_MAINT'))
        const c2 = getCategoryColor(cat('BOM_MAINT'))
        expect(c1).toBe(c2)
        expect(c1).toMatch(/^#[0-9a-fA-F]{6}$/)
    })
})

describe('getCategoryLabel', () => {
    it('有 fallback 用 fallback', () => {
        expect(getCategoryLabel(cat('CODING'), '寫程式')).toBe('寫程式')
    })
    it('沒 fallback 用 raw code', () => {
        expect(getCategoryLabel(cat('CODING'))).toBe('CODING')
    })
    it('空 code 沒 fallback 給「未分類」', () => {
        expect(getCategoryLabel(cat(''))).toBe('未分類')
    })
})
