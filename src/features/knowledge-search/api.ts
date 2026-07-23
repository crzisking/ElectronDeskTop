/**
 * 知識檢索 — API 層。兩條通道,對應平台兩個端點:
 *  1. 選庫:`GET /access/visibility/{employee_no}` —— 普通請求/響應。
 *  2. 問答:`POST /chat/kb/stream` —— SSE 串流,走 raw fetch + ReadableStream(axios 無法處理持續流)。
 *
 * 平台地址由 VITE_KB_QA_URL 提供(已含 /api/v1 前綴),dev/prod 各自配置。
 *
 * **為什麼兩條都用 raw fetch、不走 httpClientFor**:
 *   dataMiddlePlatform 一期**內網無鑑權、且返回裸 JSON**(不是主後端的 {code,message,data} 信封)。
 *   httpClientFor 的攔截器會注入 token 並「剝掉 data 外層」——對裸 JSON 會把整個物件當外層剝掉、
 *   返回 undefined(踩過:visibility 拿到 undefined.knowledge_bases 崩)。故這裡直接 fetch + 原樣 JSON。
 */

import {logger} from '@/shared/utils/logger'
import {SseEventParser} from './sse-parser'
import type {KbChatRequest, SourceOut, VisibilityOut} from './types'

/** 平台 API 根地址(含 /api/v1)。缺省回退到測試服,避免 undefined 拼出壞 URL。 */
const KB_QA_BASE = (import.meta.env.VITE_KB_QA_URL as string | undefined) ?? 'http://localhost:8000/api/v1'

/**
 * 查某工號可見的知識庫(+ 群組),用於填「選庫」下拉。
 * 只會列出該工號有權進的庫,選了就不會在問答時被平台 403。
 * 平台回裸 JSON,直接解析(不經 httpClientFor 的剝殼攔截器,見檔頭說明)。
 */
export async function fetchVisibility(employeeNo: string): Promise<VisibilityOut> {
    const response = await fetch(
        `${KB_QA_BASE}/access/visibility/${encodeURIComponent(employeeNo)}`,
        {headers: {'X-Client-Type': 'electron-desktop'}},
    )
    if (!response.ok) throw new Error(await extractErrorMessage(response))
    return (await response.json()) as VisibilityOut
}

/** 串流問答的回調集合:各事件到達時分別觸發。 */
export interface KbChatStreamHandlers {
    /** 收到本輪會話 ID(meta 事件)。 */
    onMeta?: (conversationId: string) => void
    /** 收到一個 token(逐字累加做打字機)。 */
    onToken: (token: string) => void
    /** 收到本輪引用來源(sources 事件)。 */
    onSources?: (sources: SourceOut[]) => void
    /** 本輪正常結束(done 事件)。 */
    onDone?: () => void
}

/**
 * 發起指定庫的流式問答。
 *
 * 錯誤語義(平台開流前校驗,走普通 HTTP、不進 SSE):
 *  - 404 庫不存在 / 403 無權 / 400 沒給庫或工號 → response.ok 為 false,這裡拋出讓上層提示。
 * 中止:傳入的 signal abort 時,fetch 立即斷開;AbortError 由上層辨識為「使用者主動取消」,不算錯。
 *
 * @returns 串流正常跑完後 resolve;中途出錯(含非 2xx)reject。
 */
export async function streamKbChat(
    req: KbChatRequest,
    handlers: KbChatStreamHandlers,
    signal: AbortSignal,
): Promise<void> {
    const response = await fetch(`${KB_QA_BASE}/chat/kb/stream`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(req),
        signal,
    })

    // 開流前校驗失敗(404/403/400)在這裡體現為非 2xx,body 是 {code,message,detail}。
    if (!response.ok) {
        const message = await extractErrorMessage(response)
        throw new Error(message)
    }
    if (!response.body) throw new Error('回應沒有內容(空 body)')

    const reader = response.body.getReader()
    const decoder = new TextDecoder('utf-8')
    const parser = new SseEventParser()

    const dispatch = (events: ReturnType<SseEventParser['push']>): void => {
        for (const ev of events) {
            switch (ev.event) {
                case 'meta':
                    handlers.onMeta?.(safeParseConversationId(ev.data))
                    break
                case 'sources':
                    handlers.onSources?.(safeParseSources(ev.data))
                    break
                case 'done':
                    handlers.onDone?.()
                    break
                case 'message':
                default:
                    // 預設事件即逐字 token(平台 yield {"data": token} 不帶 event 名)。
                    if (ev.data) handlers.onToken(ev.data)
                    break
            }
        }
    }

    // decode 用 stream:true 逐 chunk 累積;parser 內部再處理跨 chunk 的事件截斷。
    while (true) {
        const {done, value} = await reader.read()
        if (done) {
            dispatch(parser.flush())
            break
        }
        dispatch(parser.push(decoder.decode(value, {stream: true})))
    }
}

/** 從非 2xx 回應盡力抽一句可讀錯誤;抽不到就退回狀態碼。 */
async function extractErrorMessage(response: Response): Promise<string> {
    try {
        const body = (await response.json()) as { message?: string }
        if (body?.message) return body.message
    } catch {
        // body 非 JSON,忽略,走下面的兜底
    }
    return `請求失敗(HTTP ${response.status}）`
}

/** 解析 meta 事件的 conversation_id;壞資料兜底回空串,不讓整輪崩掉。 */
function safeParseConversationId(data: string): string {
    try {
        return (JSON.parse(data) as { conversation_id?: string }).conversation_id ?? ''
    } catch {
        logger.warn('meta 事件解析失敗', 'knowledge-search', {data})
        return ''
    }
}

/** 解析 sources 事件的來源陣列;壞資料兜底回空陣列。 */
function safeParseSources(data: string): SourceOut[] {
    try {
        const parsed = JSON.parse(data)
        return Array.isArray(parsed) ? (parsed as SourceOut[]) : []
    } catch {
        logger.warn('sources 事件解析失敗', 'knowledge-search', {data})
        return []
    }
}
