import {reactive, ref} from 'vue'
import {describe, expect, it} from 'vitest'
import {plain} from '@/shared/utils/ipc-clone'

describe('plain (IPC 出境淨化)', () => {
    it('Vue reactive Proxy → 純物件(structured clone 能序列化)', () => {
        const r = reactive({title: 'a', items: [{id: 1}]})
        const p = plain(r)
        expect(p).toEqual({title: 'a', items: [{id: 1}]})
        // 不再是 Proxy:用 structuredClone 驗證可被 clone(reactive 直接 clone 會丟錯)
        expect(() => structuredClone(p)).not.toThrow()
    })

    it('剝掉 undefined 欄位(JSON 行為)', () => {
        expect(plain({a: 1, b: undefined})).toEqual({a: 1})
    })

    it('ref 解包後的值也能淨化', () => {
        const v = ref({n: 5})
        expect(plain(v.value)).toEqual({n: 5})
    })

    it('深層巢狀照樣淨化', () => {
        const r = reactive({a: {b: {c: [1, 2]}}})
        expect(plain(r)).toEqual({a: {b: {c: [1, 2]}}})
    })
})
