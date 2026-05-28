/**
 * useAgentStream — OpenAI ChatCompletion stream 解析。
 *
 * 從 useAgentChat 拆出來(§1.7),職責單一:
 *   消費 stream → 把 text delta append 到 assistantMsg.content(打字機效果)
 *               → 把 reasoning_content delta append 到 assistantMsg.reasoningContent(thinking 卡片)
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
 * DeepSeek V4 / Claude extended thinking / OpenAI o-series 的 reasoning_content。
 * openai SDK 型別目前沒原生支援(非標準欄位),我們手動 cast 取值。
 */
interface ChunkDeltaWithReasoning {
    reasoning_content?: string | null
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
    let reasoningBuf = ''
    // tool_calls 按 index 累積(SSE delta 可能跨多個 chunk 才把 function.arguments 傳完)
    const toolCallsAcc = new Map<number, { id: string; name: string; argsBuf: string }>()
    let finishReason: string | null = null

    // ── rAF 節流(對應 doc 17 §4.1) ──────────────────────────────────
    // 流速 60-80 token/s 場景下,每個 token 都 mutate 會觸發 Vue 全鏈路 reactive 更新;
    // 下游接上 markdown / hljs 後每次 ~5-15ms,500 token 訊息累積到 60ms+ 卡頓。
    // 改用 requestAnimationFrame 把實際寫入收斂到顯示器刷新節奏(~60Hz),
    // 下游 markdown 解析從 500 次降到 ~60 次,UX 仍然平滑。
    //
    // content 與 reasoning_content 各用一個 buffer,但共用一個 rAF tick(同一幀內一起 flush)。
    let pendingFlush: number | null = null
    const flushNow = () => {
        assistantMsg.content = contentBuf
        // 思考鏈為空字串時不寫 undefined(parseBlocks 用 truthy 判斷,寫空字串也行)
        if (reasoningBuf) assistantMsg.reasoningContent = reasoningBuf
    }
    const scheduleFlush = () => {
        if (pendingFlush !== null) return
        pendingFlush = requestAnimationFrame(() => {
            pendingFlush = null
            flushNow()
        })
    }

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
                scheduleFlush()
            }
            // DeepSeek V4 / Claude / o-series:thinking 內容跟 content 平行流出
            // SDK 型別不認 reasoning_content,手動 narrow 後取
            const reasoning = (delta as ChunkDeltaWithReasoning | undefined)?.reasoning_content
            if (reasoning) {
                reasoningBuf += reasoning
                scheduleFlush()
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
        // 流結束強制 flush:避免末尾 token 落在 pending rAF 內被取消
        if (pendingFlush !== null) {
            cancelAnimationFrame(pendingFlush)
            pendingFlush = null
        }
        flushNow()
    }

    const toolCalls: OpenAIToolCall[] = Array.from(toolCallsAcc.values()).map((acc) => ({
        id: acc.id,
        type: 'function' as const,
        function: {name: acc.name, arguments: acc.argsBuf || '{}'},
    }))

    return {toolCalls, finishReason}
}
