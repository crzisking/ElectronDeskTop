import {describe, expect, it} from 'vitest'
import {unwrapIpc} from '@/shared/utils/ipc'

describe('unwrapIpc', () => {
    it('ok 回 data', async () => {
        await expect(unwrapIpc(Promise.resolve({ok: true, data: 42}))).resolves.toBe(42)
    })
    it('可指定型別斷言(data 為 unknown 時)', async () => {
        const data = await unwrapIpc<{ n: number }>(Promise.resolve({ok: true, data: {n: 1} as unknown}))
        expect(data.n).toBe(1)
    })
    it('!ok 拋出 error 訊息', async () => {
        await expect(unwrapIpc(Promise.resolve({ok: false, error: '壞了'}))).rejects.toThrow('壞了')
    })
})
