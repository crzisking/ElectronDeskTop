/**
 * 知識檢索 — 型別定義(對齊 dataMiddlePlatform 的接口契約)。
 *
 * 平台端點(見 docs/24-RAG單一知識庫問答設計.md):
 *  - GET  /api/v1/access/visibility/{employee_no}  → 該工號可見的群組 + 知識庫
 *  - POST /api/v1/chat/kb/stream                    → 指定庫的流式問答(SSE)
 *
 * 注意:GET 走 httpClientFor,攔截器已剝掉 {code,message,data} 外層,故型別直接對應 data。
 */

/** 一則對話歷史訊息。role 標明是使用者說的還是助手說的(對齊平台 ChatTurn)。 */
export interface ChatTurn {
    role: 'user' | 'assistant'
    content: string
}

/** 知識庫簡要(選庫下拉用)。 */
export interface KbBrief {
    id: number
    name: string
    /** 業務代號,如 QUALITY;問答時當作 kb_codes 傳回平台。 */
    code: string
}

/** 群組簡要。 */
export interface GroupBrief {
    id: number
    name: string
    code: string
}

/** GET /access/visibility/{employee_no} 的回應(已剝殼)。 */
export interface VisibilityOut {
    employee_no: string
    groups: GroupBrief[]
    /** 該工號可見的知識庫;選庫下拉只列這些,避免選到會 403 的庫。 */
    knowledge_bases: KbBrief[]
}

/** 回答引用的一個來源文檔(對齊平台 SourceOut)。 */
export interface SourceOut {
    document_id: number
    document_name: string
    /** MinIO 預簽名下載鏈接,限時有效(約 1 小時),用時現取、不快取。 */
    download_url: string
}

/** POST /chat/kb/stream 的請求體(對齊平台 KbChatRequest)。 */
export interface KbChatRequest {
    message: string
    /** 桌面自管會話:不傳由服務端生成並在 meta 回傳。 */
    conversation_id?: string | null
    /** 桌面端固定 false:用自帶 history,不碰平台會話表。 */
    persist: false
    history: ChatTurn[]
    /** 不傳用平台預設模型。 */
    model?: string | null
    /** 工號(必填,否則平台回 400);權限過濾依據。 */
    employee_no: string
    /** 限定的知識庫代號列表;單一知識庫 = 一個元素。 */
    kb_codes: string[]
}

/**
 * SSE 事件(平台問答流)。四種:
 *  - meta    :本輪會話 ID(data 是 {conversation_id})
 *  - message :一個 token(無 event 名時的預設事件;累加成打字機)
 *  - sources :本輪引用來源(data 是 SourceOut[] 的 JSON)
 *  - done    :本輪結束(data 空)
 */
export type SseEventName = 'meta' | 'message' | 'sources' | 'done'

export interface SseEvent {
    event: SseEventName | string
    data: string
}

/** 一則聊天泡泡(渲染用)。 */
export interface ChatMessage {
    role: 'user' | 'assistant'
    content: string
    /** 助手訊息答完後掛上的引用來源。 */
    sources?: SourceOut[]
    /** 助手訊息串流中(打字機進行中)。 */
    streaming?: boolean
}
