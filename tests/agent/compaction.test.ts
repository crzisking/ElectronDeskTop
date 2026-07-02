import {describe, expect, it} from 'vitest'
import {
    COMPACT_THRESHOLD,
    estimateRowsTokens,
    estimateTokens,
    shouldCompact,
    summaryContextPrefix,
    usageInputTokens,
} from '../../electron/main/agent/compaction'
import type {AgentMessage} from '../../electron/shared/types/agent.types'

function msg(partial: Partial<AgentMessage>): AgentMessage {
    return {id: 'x', conversationId: 'c', role: 'user', content: '', timestamp: 0, ...partial}
}

describe('estimateTokens', () => {
    it('空 / 空白回 0', () => {
        expect(estimateTokens('')).toBe(0)
        expect(estimateTokens(undefined)).toBe(0)
        expect(estimateTokens(null)).toBe(0)
    })
    it('約字元數 / 3(無條件進位)', () => {
        expect(estimateTokens('abc')).toBe(1)
        expect(estimateTokens('abcd')).toBe(2)
        expect(estimateTokens('a'.repeat(30))).toBe(10)
    })
})

describe('estimateRowsTokens', () => {
    it('累加 content 與 reasoning', () => {
        const rows = [
            msg({content: 'a'.repeat(30)}),                              // 10
            msg({content: 'b'.repeat(30), reasoningContent: 'c'.repeat(30)}), // 10 + 10
        ]
        expect(estimateRowsTokens(rows)).toBe(30)
    })
    it('空陣列回 0', () => {
        expect(estimateRowsTokens([])).toBe(0)
    })
})

describe('usageInputTokens', () => {
    it('讀 v7 的 inputTokens', () => {
        expect(usageInputTokens({inputTokens: 1234})).toBe(1234)
    })
    it('相容舊命名 promptTokens', () => {
        expect(usageInputTokens({promptTokens: 555})).toBe(555)
    })
    it('缺 / 非數字 / 非物件 → 0', () => {
        expect(usageInputTokens(null)).toBe(0)
        expect(usageInputTokens({})).toBe(0)
        expect(usageInputTokens({inputTokens: 0})).toBe(0)
        expect(usageInputTokens('nope')).toBe(0)
    })
})

describe('shouldCompact', () => {
    it('達門檻(0.9)才壓縮', () => {
        expect(shouldCompact(89, 100)).toBe(false)
        expect(shouldCompact(90, 100)).toBe(true)   // 100 * 0.9
        expect(shouldCompact(120, 100)).toBe(true)
    })
    it('contextLimit ≤ 0 視為停用', () => {
        expect(shouldCompact(1_000_000, 0)).toBe(false)
        expect(shouldCompact(1_000_000, -1)).toBe(false)
    })
    it('門檻常數為 0.9', () => {
        expect(COMPACT_THRESHOLD).toBe(0.9)
    })
})

describe('summaryContextPrefix', () => {
    it('包住摘要且標明非新訊息', () => {
        const out = summaryContextPrefix('做了 A 和 B')
        expect(out).toContain('做了 A 和 B')
        expect(out).toContain('先前對話的摘要')
    })
})
