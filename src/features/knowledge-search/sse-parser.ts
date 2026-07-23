/**
 * SSE 事件解析器 — 把 fetch 串流的原始文字切成一個個 {event, data} 事件。
 *
 * 為什麼要自己寫(不像 useRepairPolish 只看 data: 行)：
 *   平台用 sse-starlette,一個事件是「若干行 + 一個空行」的區塊,且可能帶具名事件:
 *
 *       event: meta\r\n
 *       data: {"conversation_id":"abc"}\r\n
 *       \r\n                     ← 空行 = 事件結束
 *       data: 你好\r\n            ← 沒有 event 行 → 預設事件名 message(逐字 token)
 *       \r\n
 *       event: sources\r\n
 *       data: [ ... ]\r\n
 *       \r\n
 *
 *   難點:① 分隔是 \r\n(非 \n);② 事件跨 chunk 會被截斷;③ 一個事件可有多行 data
 *   (SSE 規範:多個 data 行用 \n 拼接)——token 內含換行時平台就會拆多行 data。
 *
 * 用法:
 *   const parser = new SseEventParser()
 *   for await (chunk) { for (const ev of parser.push(chunk)) handle(ev) }
 *   for (const ev of parser.flush()) handle(ev)   // 收尾:處理最後殘留(通常沒有)
 *
 * 只做「切事件」,不碰業務語義(誰是 meta / token / sources 由呼叫方判斷)。
 */

import type {SseEvent} from './types'

export class SseEventParser {
    /** 跨 chunk 緩衝:尚未湊齊一個完整事件(未遇到空行)的殘餘文字。 */
    private buffer = ''

    /**
     * 餵入一段新到的文字,吐出這段之後能湊齊的所有完整事件。
     * 湊不齊的尾巴留在 buffer 裡,等下一段再拼。
     */
    push(chunk: string): SseEvent[] {
        this.buffer += chunk
        const events: SseEvent[] = []

        // 事件之間以「空行」分隔。統一按 \r\n / \n 兼容:先把 \r\n 歸一成 \n,
        // 再用連續兩個換行(\n\n)切事件區塊。歸一只為切塊,不影響 data 內容(data 已在行內)。
        const normalized = this.buffer.replace(/\r\n/g, '\n')
        const blocks = normalized.split('\n\n')

        // 最後一塊可能是「還沒收到空行」的半個事件,留回 buffer(用歸一後的形式即可)。
        this.buffer = blocks.pop() ?? ''

        for (const block of blocks) {
            const ev = this.parseBlock(block)
            if (ev) events.push(ev)
        }
        return events
    }

    /**
     * 串流結束時呼叫:若 buffer 裡還剩一個沒有尾隨空行的完整事件,補處理掉。
     * 正常情況平台每個事件都帶空行結尾,這裡多半返回空陣列,是防禦性收尾。
     */
    flush(): SseEvent[] {
        const rest = this.buffer.trim()
        this.buffer = ''
        if (!rest) return []
        const ev = this.parseBlock(rest)
        return ev ? [ev] : []
    }

    /**
     * 解析單一事件區塊(已不含分隔空行)。
     * 收集 event: 行(取最後一個)與所有 data: 行(多行以 \n 拼接,對齊 SSE 規範)。
     * 冒號後若有一個前導空格,依 SSE 規範去掉一個(保留其餘,token 前導空格不丟)。
     */
    private parseBlock(block: string): SseEvent | null {
        let eventName = ''
        const dataLines: string[] = []

        for (const line of block.split('\n')) {
            if (line === '' || line.startsWith(':')) continue // 空行 / 註釋(心跳)略過
            const colon = line.indexOf(':')
            const field = colon === -1 ? line : line.slice(0, colon)
            let value = colon === -1 ? '' : line.slice(colon + 1)
            if (value.startsWith(' ')) value = value.slice(1) // 去掉一個前導空格
            if (field === 'event') eventName = value
            else if (field === 'data') dataLines.push(value)
        }

        // 沒有任何 data 行的區塊(理論上不會有)直接丟棄。
        if (dataLines.length === 0 && eventName === '') return null
        // 無 event 名 → 預設 message(SSE 規範),對齊平台的逐字 token 事件。
        return {event: eventName || 'message', data: dataLines.join('\n')}
    }
}
