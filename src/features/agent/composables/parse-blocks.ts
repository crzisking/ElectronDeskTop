/**
 * parse-blocks — AgentMessage → MessageBlock[](對應 doc 17 §8.4 + doc 18 §2)。
 *
 * 純函式,跟 Vue 解耦,易於單元測試。
 *
 * 規則:
 *   - assistant 訊息的 content 內若有 <think>...</think>(或 <thinking>...</thinking>)
 *     → 拆成 thinking block + text block(可以有多段交錯)
 *   - assistant + 有 toolCalls → 在 content blocks 後 append tool_call(每個 toolCall)
 *   - user / 其它角色 → 不切 thinking(<think> 通常是 LLM 自我標註,使用者不會這樣寫)
 *   - tool / system 不會直接渲染,由 assistant 透過 toolResults map 引用
 *
 * Streaming 容錯:
 *   - 未閉合的 <think>(只開未關)→ 視為 thinking 區段,把剩餘所有內容當思考(用戶會看到「思考中」)
 *   - 流結束後若 LLM 自然關閉了 </think>,下一輪重算就會切回 text
 *
 * 將來擴充(無需動 LLM / DB):
 *   - ```mermaid → mermaid block(不走 hljs)
 *   - [^ref-N] + msg.metadata.citations → citation block
 */

import type {AgentMessage, MessageBlock, ToolResult} from '../types'

/**
 * 同時匹配 <think>...</think> 和 <thinking>...</thinking>(寬鬆相容)。
 * - 容忍多行內容([\s\S]*?)
 * - 容忍未閉合(? 在 ($|</think...)),streaming 中也能正確切出 thinking 段
 * - 不區分大小寫(i 旗標)— 模型偶爾會吐 <Think> 之類
 */
const THINK_TAG_RE = /<(think|thinking)>([\s\S]*?)(?:<\/\1>|$)/gi

/** 把 content 字串切成 thinking + text 交錯的 blocks 陣列 */
function splitThinkingBlocks(content: string): MessageBlock[] {
    if (!content) return []

    const out: MessageBlock[] = []
    let lastIndex = 0
    let match: RegExpExecArray | null

    // 為什麼新建 RegExp 而不直接用 module-level 的:`g` 旗標的 lastIndex 是有狀態的,
    // 多次呼叫同一個 instance 會踩坑;每次切分用 fresh re。
    const re = new RegExp(THINK_TAG_RE.source, THINK_TAG_RE.flags)

    while ((match = re.exec(content)) !== null) {
        // 在 thinking 標籤前的純文字
        if (match.index > lastIndex) {
            const before = content.slice(lastIndex, match.index)
            if (before.trim()) out.push({type: 'text', content: before})
        }

        const thinkingContent = match[2]
        if (thinkingContent.trim()) {
            out.push({type: 'thinking', content: thinkingContent})
        }
        lastIndex = re.lastIndex

        // 防無限迴圈:零寬匹配時手動推進
        if (match.index === re.lastIndex) re.lastIndex++
    }

    // 最後一段 thinking 後的純文字
    if (lastIndex < content.length) {
        const after = content.slice(lastIndex)
        if (after.trim()) out.push({type: 'text', content: after})
    }

    // 沒匹配到 thinking → 整段當 text(短路常見情況)
    if (out.length === 0 && content.trim()) {
        out.push({type: 'text', content})
    }

    return out
}

export function parseBlocks(
    msg: AgentMessage,
    /** toolCallId → result。由 ChatMessage 從 store 索引出來傳入,O(1) 查 */
    toolResults: Map<string, ToolResult>,
): MessageBlock[] {
    const blocks: MessageBlock[] = []

    // ── 流外 reasoning_content(DeepSeek V4 / Claude / o-series) ─────────
    // 它跟 content 平行,設計上**永遠在 content 前面顯示**(模型先思考再回答)
    if (msg.role === 'assistant' && msg.reasoningContent && msg.reasoningContent.trim()) {
        blocks.push({type: 'thinking', content: msg.reasoningContent})
    }

    // assistant 訊息:content 內可能含 <think> 標籤(模型 prompt 自我標註的舊路徑),先切;
    // 其它角色直接走單一 text
    if (msg.content && msg.content.trim()) {
        if (msg.role === 'assistant') {
            blocks.push(...splitThinkingBlocks(msg.content))
        } else {
            blocks.push({type: 'text', content: msg.content})
        }
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
