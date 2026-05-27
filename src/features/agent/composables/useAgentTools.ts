/**
 * useAgentTools — 工具呼叫批次執行 + tool 訊息產出。
 *
 * 從 useAgentChat 拆出來(§1.7),負責:
 *   1. 解析每個 tool_call 的 function.arguments(JSON string → object)
 *   2. 透過 executeAgentTool 路由執行(renderer 直接執行 / main 走 IPC)
 *   3. 把結果包裝成 tool role 的 AgentMessage 注入 store + 持久化
 *
 * 純流程函式,不持有狀態。被 useAgentChat 每輪迴圈呼叫一次(若該輪有 tool_calls)。
 */

import {uuid} from '@/utils/uuid'
import {executeAgentTool} from '../tools'
import type {AgentMessage, OpenAIToolCall} from '../types'
import {MAX_TOOL_CONTENT_FOR_LLM, previewFor, truncate} from './agent-utils'

interface RunToolsOptions {
    toolCalls: OpenAIToolCall[]
    conversationId: string
    /** 中止信號:工具串列執行中發現 aborted 就停 */
    controller: AbortController | null

    /** 注入 store(addMessage)+ 持久化(window.agentAPI.saveMessage) */
    addMessage(msg: AgentMessage): void
}

/**
 * 串列執行 tool_calls,把每個結果包裝成 tool 訊息塞回對話。
 *
 * 失敗工具的 content 會以 `ERROR: xxx` 形式餵 LLM(不 throw),
 * 讓 LLM 在下一輪可以讀到錯誤並決定要不要重試 / 換路徑。
 *
 * @returns 是否被中止(true 代表呼叫方應該整個結束循環)
 */
export async function runTools(opts: RunToolsOptions): Promise<boolean> {
    for (const tc of opts.toolCalls) {
        if (opts.controller?.signal.aborted) return true

        let parsedArgs: Record<string, unknown> = {}
        try {
            parsedArgs = JSON.parse(tc.function.arguments || '{}')
        } catch {
            parsedArgs = {}
        }

        const result = await executeAgentTool(tc.function.name, parsedArgs)
        const llmContent = result.ok
            ? truncate(result.content, MAX_TOOL_CONTENT_FOR_LLM)
            : `ERROR: ${result.error ?? '未知錯誤'}`

        const toolMsg: AgentMessage = {
            id: uuid(),
            conversationId: opts.conversationId,
            role: 'tool',
            content: llmContent,
            toolCallId: tc.id,
            timestamp: Date.now(),
            toolDisplay: {
                ok: result.ok,
                preview: previewFor(tc.function.name, result.ok ? result.content : result.error ?? ''),
            },
        }

        opts.addMessage(toolMsg)
        void window.agentAPI.saveMessage(toolMsg)
    }
    return false
}
