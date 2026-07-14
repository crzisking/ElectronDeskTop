import {describe, expect, it} from 'vitest'
import {DEFAULT_HOTKEY, isValidAccelerator, normalizeHotkey} from '../../electron/shared/idea-capture/hotkey'

describe('isValidAccelerator', () => {
    it('合法組合', () => {
        expect(isValidAccelerator('CommandOrControl+Shift+Space')).toBe(true)
        expect(isValidAccelerator('Ctrl+Alt+I')).toBe(true)
        expect(isValidAccelerator('Alt+F4')).toBe(true)
        expect(isValidAccelerator('Ctrl+Shift+1')).toBe(true)
        expect(isValidAccelerator('Super+D')).toBe(true)
    })
    it('恰好一個按鍵才合法', () => {
        expect(isValidAccelerator('Ctrl+A+B')).toBe(false) // 兩個按鍵
        expect(isValidAccelerator('Ctrl+Shift')).toBe(false) // 沒按鍵
    })
    it('預設熱鍵本身合法', () => {
        expect(isValidAccelerator(DEFAULT_HOTKEY)).toBe(true)
    })
    it('非法輸入', () => {
        expect(isValidAccelerator('')).toBe(false)
        expect(isValidAccelerator(null)).toBe(false)
        expect(isValidAccelerator('Ctrl+Foo')).toBe(false) // Foo 不是合法按鍵
    })
})

describe('normalizeHotkey', () => {
    it('合法原樣回', () => {
        expect(normalizeHotkey('Ctrl+Alt+I')).toBe('Ctrl+Alt+I')
    })
    it('不合法 / 空 → 預設', () => {
        expect(normalizeHotkey('')).toBe(DEFAULT_HOTKEY)
        expect(normalizeHotkey('garbage+++')).toBe(DEFAULT_HOTKEY)
        expect(normalizeHotkey(null)).toBe(DEFAULT_HOTKEY)
    })
})
