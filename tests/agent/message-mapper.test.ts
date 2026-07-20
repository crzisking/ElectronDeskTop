import {describe, expect, it} from 'vitest'
import {responseMessagesToRows, rowsToModelMessages} from '@main/agent/message-mapper'
import type {AgentMessage} from '@shared/types/agent.types'

// AI-SDK response message 的鬆散形狀(按 type 分流);cast 給函式參數型別
type Msgs = Parameters<typeof responseMessagesToRows>[1]
const as = (m: unknown[]): Msgs => m as unknown as Msgs

describe('responseMessagesToRows(SDK response → AgentMessage 行)', () => {
    it('assistant 字串內容 → 一行,timestamp=baseTs,無 reasoning/toolCalls', () => {
        const rows = responseMessagesToRows('c1', as([{role: 'assistant', content: 'hi'}]), 1000)
        expect(rows).toHaveLength(1)
        expect(rows[0]).toMatchObject({conversationId: 'c1', role: 'assistant', content: 'hi', timestamp: 1000})
        expect(rows[0].reasoningContent).toBeUndefined()
        expect(rows[0].toolCalls).toBeUndefined()
    })

    it('assistant part 陣列:text 累加 / reasoning 收集 / tool-call 抽出', () => {
        const msg = {
            role: 'assistant',
            content: [
                {type: 'text', text: 'a'},
                {type: 'reasoning', text: 'think'},
                {type: 'text', text: 'b'},
                {type: 'tool-call', toolCallId: 't1', toolName: 'read', input: {path: 'x'}},
            ],
        }
        const rows = responseMessagesToRows('c1', as([msg]), 5)
        expect(rows[0].content).toBe('ab')
        expect(rows[0].reasoningContent).toBe('think')
        expect(rows[0].toolCalls).toEqual([{toolCallId: 't1', name: 'read', input: {path: 'x'}}])
    })

    it('tool 訊息:每個 tool-result 一行,output 序列化(物件→JSON / 字串原樣 / null→空)', () => {
        const msg = {
            role: 'tool',
            content: [
                {type: 'tool-result', toolCallId: 't1', output: {ok: true}},
                {type: 'tool-result', toolCallId: 't2', output: 'plain'},
                {type: 'tool-result', toolCallId: 't3', output: null},
            ],
        }
        const rows = responseMessagesToRows('c1', as([msg]), 10)
        expect(rows).toHaveLength(3)
        expect(rows[0]).toMatchObject({role: 'tool', toolCallId: 't1', content: '{"ok":true}'})
        expect(rows[1]).toMatchObject({role: 'tool', toolCallId: 't2', content: 'plain'})
        expect(rows[2].content).toBe('')
    })

    it('timestamp 遞增(assistant 後接 tool)', () => {
        const msgs = as([
            {role: 'assistant', content: 'x'},
            {role: 'tool', content: [{type: 'tool-result', toolCallId: 't1', output: 'r'}]},
        ])
        const rows = responseMessagesToRows('c1', msgs, 100)
        expect(rows.map((r) => r.timestamp)).toEqual([100, 101])
    })
})

describe('rowsToModelMessages(AgentMessage 行 → SDK ModelMessage,resume 灌歷史)', () => {
    const row = (r: Partial<AgentMessage>): AgentMessage =>
        ({id: 'i', conversationId: 'c', role: 'user', content: '', timestamp: 0, ...r}) as AgentMessage

    it('user / 有內容 assistant / system 保留;空 assistant 與 tool 丟棄', () => {
        const rows = [
            row({role: 'user', content: 'u'}),
            row({role: 'assistant', content: 'a'}),
            row({role: 'assistant', content: ''}),   // 空 → 丟
            row({role: 'system', content: 's'}),
            row({role: 'tool', content: 't', toolCallId: 'x'}),   // tool → 丟
        ]
        expect(rowsToModelMessages(rows)).toEqual([
            {role: 'user', content: 'u'},
            {role: 'assistant', content: 'a'},
            {role: 'system', content: 's'},
        ])
    })
})
