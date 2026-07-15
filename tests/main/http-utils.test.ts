import {describe, expect, it} from 'vitest'
import {appendUserId, buildQuery, fetchCause, isRetryableCause, joinUrl,} from '@main/services/http/http-utils'

describe('joinUrl(拼接 base + path,不出現雙斜線/缺斜線)', () => {
    it('base 有尾斜線 + path 有首斜線', () => {
        expect(joinUrl('http://x:5247/', '/api/m')).toBe('http://x:5247/api/m')
    })
    it('base 無尾斜線 + path 無首斜線', () => {
        expect(joinUrl('http://x:5247', 'api/m')).toBe('http://x:5247/api/m')
    })
    it('一邊有一邊沒有', () => {
        expect(joinUrl('http://x:5247/', 'api/m')).toBe('http://x:5247/api/m')
        expect(joinUrl('http://x:5247', '/api/m')).toBe('http://x:5247/api/m')
    })
})

describe('appendUserId(把工號接到 query)', () => {
    it('已有 query → 用 & 接', () => {
        expect(appendUserId('/api/m?a=1', 'S001')).toBe('/api/m?a=1&userId=S001')
    })
    it('沒有 query → 用 ? 接', () => {
        expect(appendUserId('/api/m', 'S001')).toBe('/api/m?userId=S001')
    })
    it('空工號 → 原樣不接', () => {
        expect(appendUserId('/api/m', '')).toBe('/api/m')
    })
    it('工號做 URL 編碼', () => {
        expect(appendUserId('/api/m', 'a b')).toBe('/api/m?userId=a%20b')
    })
})

describe('buildQuery(物件轉 query string)', () => {
    it('濾掉 null / undefined / 空字串', () => {
        expect(buildQuery({a: 1, b: null, c: undefined, d: '', e: 'x'})).toBe('a=1&e=x')
    })
    it('key / value 都編碼', () => {
        expect(buildQuery({keyword: 'a&b'})).toBe('keyword=a%26b')
    })
    it('全空 → 空字串', () => {
        expect(buildQuery({a: null, b: ''})).toBe('')
    })
})

describe('fetchCause / isRetryableCause(網路失敗該不該重試)', () => {
    it('普通錯誤(無 cause)→ null,不重試', () => {
        expect(fetchCause(new Error('boom'))).toBeNull()
        expect(isRetryableCause(null)).toBe(false)
    })
    it('挖出底層 cause.code', () => {
        const err = Object.assign(new Error('fetch failed'), {cause: {code: 'ECONNRESET'}})
        expect(fetchCause(err)).toEqual({code: 'ECONNRESET', text: 'ECONNRESET'})
    })
    it('連線被重置 / 斷管 / socket 出錯 → 該重試', () => {
        expect(isRetryableCause({code: 'ECONNRESET'})).toBe(true)
        expect(isRetryableCause({code: 'EPIPE'})).toBe(true)
        expect(isRetryableCause({code: 'UND_ERR_SOCKET'})).toBe(true)
    })
    it('連線被拒 / 未知 → 不重試(重試也沒用)', () => {
        expect(isRetryableCause({code: 'ECONNREFUSED'})).toBe(false)
        expect(isRetryableCause({code: ''})).toBe(false)
    })
})
