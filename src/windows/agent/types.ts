/**
 * Agent 視窗的視圖層型別 —— 從 App.vue 抽出,composables 共用。
 */

// ── 視圖訊息(union) ──
export interface ChatMsg {
    id: string
    kind: 'user' | 'assistant'
    content: string
    reasoning?: string
    /** think 內容預設折疊,點擊展開 */
    reasoningOpen?: boolean
    streaming?: boolean
}

export interface ToolMsg {
    id: string // = toolUseId
    kind: 'tool'
    name: string
    input: unknown
    output?: unknown
    isError?: boolean
    running?: boolean
    /** 預設折疊,點擊展開看 input/output */
    open?: boolean
}

export type ViewMsg = ChatMsg | ToolMsg

/** 顯示用:連續的工具訊息折成一組(整組預設折疊) */
export interface ToolGroup {
    kind: 'tool-group'
    /** 組 id = 該組第一則工具的 id(串流追加同組時保持穩定) */
    id: string
    tools: ToolMsg[]
}

export type DisplayItem = ChatMsg | ToolGroup

/** 權限彈框請求(Stage 2) */
export interface PermReq {
    conversationId: string
    approvalId: string
    tool: string
    subject: string
    input: unknown
    suggestedPattern: string
}

/** DB 訊息行 → 視圖(只顯示 user/assistant;工具卡只在當輪即時渲,不從歷史重建) */
export interface RawRow {
    id: string
    role: string
    content: string
    reasoningContent?: string
    timestamp: number
}
