/**
 * 知識檢索 SSE 解析器測試。
 *
 * 重點覆蓋平台(sse-starlette)的真實情形:
 *  - \r\n 分隔、具名事件(meta/sources/done)與無名事件(逐字 token)
 *  - 事件跨 chunk 被截斷後,能在下一個 chunk 拼回
 *  - 多行 data 以 \n 拼接;前導空格按 SSE 規範去掉一個(保留其餘)
 */
import {describe, expect, it} from 'vitest'
import {SseEventParser} from '@/features/knowledge-search/sse-parser'

describe('SseEventParser', () => {
    it('解析具名事件(meta)與無名 token 事件', () => {
        const parser = new SseEventParser()
        const events = parser.push(
            'event: meta\r\ndata: {"conversation_id":"abc"}\r\n\r\ndata: 你好\r\n\r\n',
        )
        expect(events).toEqual([
            {event: 'meta', data: '{"conversation_id":"abc"}'},
            {event: 'message', data: '你好'},
        ])
    })

    it('事件跨 chunk 截斷,下一個 chunk 拼回', () => {
        const parser = new SseEventParser()
        // 第一段只到一半(沒有結尾空行)→ 不吐事件
        expect(parser.push('event: sour')).toEqual([])
        // 補齊剩下的 → 吐出完整 sources 事件
        const events = parser.push('ces\r\ndata: [{"document_id":1}]\r\n\r\n')
        expect(events).toEqual([{event: 'sources', data: '[{"document_id":1}]'}])
    })

    it('逐字 token 分多個 chunk 到達,各自成事件', () => {
        const parser = new SseEventParser()
        const out1 = parser.push('data: 制\r\n\r\ndata: 造\r\n\r\n')
        const out2 = parser.push('data: 業\r\n\r\n')
        expect(out1.map((e) => e.data)).toEqual(['制', '造'])
        expect(out2.map((e) => e.data)).toEqual(['業'])
        expect(out1.every((e) => e.event === 'message')).toBe(true)
    })

    it('多行 data 以換行拼接', () => {
        const parser = new SseEventParser()
        const events = parser.push('data: 第一行\r\ndata: 第二行\r\n\r\n')
        expect(events).toEqual([{event: 'message', data: '第一行\n第二行'}])
    })

    it('冒號後只去掉一個前導空格,保留其餘(token 前導空格不丟)', () => {
        const parser = new SseEventParser()
        const events = parser.push('data:  兩個空格前綴\r\n\r\n')
        expect(events).toEqual([{event: 'message', data: ' 兩個空格前綴'}])
    })

    it('done 事件 data 為空', () => {
        const parser = new SseEventParser()
        const events = parser.push('event: done\r\ndata: \r\n\r\n')
        expect(events).toEqual([{event: 'done', data: ''}])
    })

    it('flush 收尾處理無尾隨空行的殘留事件', () => {
        const parser = new SseEventParser()
        expect(parser.push('event: done\r\ndata: ')).toEqual([])
        expect(parser.flush()).toEqual([{event: 'done', data: ''}])
    })

    it('心跳註釋行(以 : 開頭)被忽略', () => {
        const parser = new SseEventParser()
        const events = parser.push(': keep-alive\r\n\r\ndata: 正文\r\n\r\n')
        expect(events).toEqual([{event: 'message', data: '正文'}])
    })
})
