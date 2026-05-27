/**
 * parse-blocks — AgentMessage → MessageBlock[](對應 doc 17 §8.4)。
 *
 * 純函式,跟 Vue 解耦,易於單元測試。
 *
 * 規則(目前):
 *   - assistant + 無 toolCalls → 單一 text block
 *   - assistant + 有 toolCalls → [text(content)] + tool_call(每個 toolCall)
 *     · content 為空字串時不產生 text block,避免空白卡片
 *   - user → 單一 text block(user 自己輸入,也走 markdown 渲染 — 無 XSS 風險,sanitize 仍兜底)
 *   - tool / system 不會直接渲染,由 assistant 透過 toolResults map 引用
 *
 * 將來擴充(無需動 LLM / DB):
 *   - <thinking>...</thinking> → thinking block
 *   - ```mermaid → mermaid block(不走 hljs)
 *   - [^ref-N] + msg.metadata.citations → citation block
 */

import type {AgentMessage, MessageBlock, ToolResult} from '../types'

export function parseBlocks(
    msg: AgentMessage,
    /** toolCallId → result。由 ChatMessage 從 store 索引出來傳入,O(1) 查 */
    toolResults: Map<string, ToolResult>,
): MessageBlock[] {
    const blocks: MessageBlock[] = []

    // text block:有內容才產出(空字串時跳過,避免 streaming 初期渲染空卡片)
    if (msg.content && msg.content.trim()) {
        blocks.push({type: 'text', content: msg.content})
    }

    // tool_call blocks:只有 assistant 訊息會帶 toolCalls
    if (msg.role === 'assistant' && msg.toolCalls?.length) {
        for (const tc of msg.toolCalls) {
            blocks.push({
                type: 'tool_call',
                toolCall: tc,
                result: toolResults.get(tc.id),
            })
        }
    }

    return blocks
}
