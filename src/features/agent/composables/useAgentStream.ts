/**
 * useAgentStream — OpenAI ChatCompletion stream 解析。
 *
 * 從 useAgentChat 拆出來(§1.7),職責單一:
 *   消費 stream → 把 text delta append 到 assistantMsg.content(打字機效果)
 *               → tool_calls 按 index 累積 JSON 字串
 *               → 維護 90 秒空閒看門狗,timeout 主動 abort
 *   ─────────────────────────
 *   返回 { toolCalls, finishReason }
 *
 * 為何叫 use* 但不是 Vue composable:慣例對齊 features/agent/composables/ 下的其它檔,
 * 內部不呼叫 useStore / ref / watch,純粹函式,測試友好。
 */

import type OpenAI from 'openai'
import type {AgentMessage, OpenAIToolCall} from '../types'
import {STREAM_IDLE_TIMEOUT_MS} from './agent-utils'

/** stream 解析完的產物 */
export interface StreamConsumeResult {
    toolCalls: OpenAIToolCall[]
    finishReason: string | null
}

/**
 * 消費一個 OpenAI stream iterator。
 *
 * `assistantMsg` 由呼叫方建立並 push 進 store(渲染端可以看到打字機效果);
 * 本函式只 mutate `assistantMsg.content`,不負責 push / save。
 *
 * @param stream         openai SDK 回傳的 chat.completions stream
 * @param assistantMsg   本輪 assistant 訊息(會 mutate `content` 屬性)
 * @param controller     AbortController,用來在 idle timeout 時 abort
 */
export async function consumeStream(
    stream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>,
    assistantMsg: AgentMessage,
    controller: AbortController | null,
): Promise<StreamConsumeResult> {
    let contentBuf = ''
    // tool_calls 按 index 累積(SSE delta 可能跨多個 chunk 才把 function.arguments 傳完)
    const toolCallsAcc = new Map<number, { id: string; name: string; argsBuf: string }>()
    let finishReason: string | null = null

    // 流空閒看門狗:每收到 chunk 就 reset,timeout 觸發 abort
    let idleTimer: ReturnType<typeof setTimeout> | null = null
    const resetIdleTimer = () => {
        if (idleTimer) clearTimeout(idleTimer)
        idleTimer = setTimeout(() => controller?.abort(), STREAM_IDLE_TIMEOUT_MS)
    }
    resetIdleTimer()

    try {
        for await (const chunk of stream) {
            resetIdleTimer()
            const choice = chunk.choices[0]
            if (!choice) continue

            const delta = choice.delta
            if (delta?.content) {
                contentBuf += delta.content
                // 直接 mutate 訊息物件,Vue 響應式追蹤 — 避免 O(n²) reactivity 重建
                assistantMsg.content = contentBuf
            }
            if (delta?.tool_calls) {
                for (const tc of delta.tool_calls) {
                    const idx = tc.index ?? 0
                    let acc = toolCallsAcc.get(idx)
                    if (!acc) {
                        acc = {id: tc.id ?? '', name: tc.function?.name ?? '', argsBuf: ''}
                        toolCallsAcc.set(idx, acc)
                    }
                    if (tc.id) acc.id = tc.id
                    if (tc.function?.name) acc.name = tc.function.name
                    if (tc.function?.arguments) acc.argsBuf += tc.function.arguments
                }
            }
            if (choice.finish_reason) finishReason = choice.finish_reason
        }
    } finally {
        if (idleTimer) clearTimeout(idleTimer)
    }

    const toolCalls: OpenAIToolCall[] = Array.from(toolCallsAcc.values()).map((acc) => ({
        id: acc.id,
        type: 'function' as const,
        function: {name: acc.name, arguments: acc.argsBuf || '{}'},
    }))

    return {toolCalls, finishReason}
}
