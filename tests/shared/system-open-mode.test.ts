import {describe, expect, it} from 'vitest'
import {isModeToggleable, resolveOpenMode} from '@/shared/utils/system-open-mode'
import type {SystemLink} from '@shared/types/config'

function link(openMode: SystemLink['openMode']): SystemLink {
    return {id: 'sys-a', name: 'A', description: '', url: 'http://a', openMode, ssoEnabled: false}
}

describe('resolveOpenMode', () => {
    it('iframe 系統恆用管理員設定,忽略覆寫', () => {
        expect(resolveOpenMode(link('iframe'), {'sys-a': 'external-browser'})).toBe('iframe')
        expect(resolveOpenMode(link('iframe'), undefined)).toBe('iframe')
    })

    it('非 iframe 系統:有覆寫用覆寫', () => {
        expect(resolveOpenMode(link('electron-window'), {'sys-a': 'external-browser'})).toBe('external-browser')
        expect(resolveOpenMode(link('external-browser'), {'sys-a': 'electron-window'})).toBe('electron-window')
    })

    it('非 iframe 系統:沒覆寫用管理員預設', () => {
        expect(resolveOpenMode(link('electron-window'), {})).toBe('electron-window')
        expect(resolveOpenMode(link('electron-window'), undefined)).toBe('electron-window')
        expect(resolveOpenMode(link('electron-window'), {'other-id': 'external-browser'})).toBe('electron-window')
    })
})

describe('isModeToggleable', () => {
    it('iframe 不可切換,其餘可切換', () => {
        expect(isModeToggleable(link('iframe'))).toBe(false)
        expect(isModeToggleable(link('electron-window'))).toBe(true)
        expect(isModeToggleable(link('external-browser'))).toBe(true)
    })
})
