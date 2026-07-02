/**
 * AI SDK 的 response messages(ModelMessage)→ 我們的 AgentMessage 行。
 *
 * 用途:agent 跑完後,把 `streamText` 的 `result.response.messages`(assistant / tool)
 * 轉成可落 agent_messages 表的 AgentMessage,供 resume + renderer 顯示。
 * 純函式,無副作用 → 可單測。
 */

import {randomUUID} from 'crypto'
import type {AssistantModelMessage, ModelMessage, ToolModelMessage} from 'ai'
import type {AgentMessage, AgentToolCall} from '../../shared/types/agent.types'

type ResponseMessage = AssistantModelMessage | ToolModelMessage

/** 內容 part 的最小視圖(避免綁死 SDK 的嚴格聯合型別;按 type 分流) */
interface Part {
    type: string
    text?: string
    toolCallId?: string
    toolName?: string
    input?: unknown
    output?: unknown
}

/**
 * @param baseTs 起始時間戳;每則訊息遞增 1ms 保持與 user 訊息之後的順序
 */
export function responseMessagesToRows(
    conversationId: string,
    messages: ResponseMessage[],
    baseTs: number,
): AgentMessage[] {
    const rows: AgentMessage[] = []
    let ts = baseTs

    for (const msg of messages) {
        if (msg.role === 'assistant') {
            rows.push(assistantToRow(conversationId, msg, ts++))
        } else if (msg.role === 'tool') {
            for (const r of toolToRows(conversationId, msg, ts)) {
                rows.push(r)
                ts++
            }
        }
    }
    return rows
}

function assistantToRow(conversationId: string, msg: AssistantModelMessage, timestamp: number): AgentMessage {
    let content = ''
    let reasoning = ''
    const toolCalls: AgentToolCall[] = []

    if (typeof msg.content === 'string') {
        content = msg.content
    } else {
        for (const p of msg.content as Part[]) {
            if (p.type === 'text' && p.text) content += p.text
            else if (p.type === 'reasoning' && p.text) reasoning += p.text
            else if (p.type === 'tool-call' && p.toolCallId && p.toolName) {
                toolCalls.push({toolCallId: p.toolCallId, name: p.toolName, input: p.input})
            }
        }
    }

    return {
        id: randomUUID(),
        conversationId,
        role: 'assistant',
        content,
        reasoningContent: reasoning || undefined,
        toolCalls: toolCalls.length ? toolCalls : undefined,
        timestamp,
    }
}

function toolToRows(conversationId: string, msg: ToolModelMessage, baseTs: number): AgentMessage[] {
    const parts = (Array.isArray(msg.content) ? msg.content : []) as Part[]
    let ts = baseTs
    return parts
        .filter((p) => p.type === 'tool-result')
        .map((p) => ({
            id: randomUUID(),
            conversationId,
            role: 'tool' as const,
            content: stringifyOutput(p.output),
            toolCallId: p.toolCallId,
            timestamp: ts++,
        }))
}

function stringifyOutput(output: unknown): string {
    if (output == null) return ''
    if (typeof output === 'string') return output
    try {
        return JSON.stringify(output)
    } catch {
        return String(output)
    }
}

/** 便捷:把 AgentMessage 反向組成 AI SDK 的 ModelMessage(resume 灌歷史用) */
export function rowsToModelMessages(rows: AgentMessage[]): ModelMessage[] {
    const out: ModelMessage[] = []
    for (const m of rows) {
        if (m.role === 'user') {
            out.push({role: 'user', content: m.content})
        } else if (m.role === 'assistant') {
            // resume 只需把文字帶回作上下文;tool_call 的往返在新一輪重新產生
            if (m.content) out.push({role: 'assistant', content: m.content})
        } else if (m.role === 'system') {
            out.push({role: 'system', content: m.content})
        }
        // tool 訊息不單獨回灌(它依附於同輪的 tool-call,resume 時以文字上下文足夠)
    }
    return out
}
