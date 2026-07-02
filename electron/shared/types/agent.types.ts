/**
 * Agent v2 跨進程型別契約(docs/19)。
 *
 * 引擎 = Vercel AI SDK v7;傳輸 = IPC(main = 無頭後端,renderer = client)。
 * 這裡只放「main / preload / renderer 三端共用」的純型別,無 runtime 物件。
 */

// ─── 權限(opencode 式宣告配置)──────────────────────────────

/** 單一決策:允許 / 問使用者 / 拒絕 */
export type PermissionVerdict = 'allow' | 'ask' | 'deny'

/**
 * 一條工具規則:
 *  - 直接一個 verdict(整個工具統一)
 *  - 或用 glob 細分(key 是 pattern,如 "git *";按序比對,最後命中者贏)
 */
export type PermissionRule = PermissionVerdict | Record<string, PermissionVerdict>

/**
 * 宣告式權限配置。key = 工具動作分類(read/edit/glob/grep/bash/webfetch/websearch/
 * external_directory/doom_loop/… 或 "*" 全域預設)。
 * 由開發者以 JSON 出廠控管,不對終端使用者開放編輯(docs/19 §5.6)。
 */
export type PermissionConfig = Record<string, PermissionRule>

// ─── Agent 配置 ─────────────────────────────────────────────

/**
 * Agent v2 運行配置(agent 自身設定)。持久化在 agent_configs KV(key 見 config-store 的 KEYS)。
 *
 * ⚠️ 模型連線(URL / model / apiKey)**不在這裡** —— 復用現有「模型設定」的 active provider
 * (AgentService 的 LlmConfig)。本型別只放 agent 特有的行為設定。
 * 「無預設 model、沒配好不可用」的判斷改由 active provider 決定(見 model-provider.isAgentReady)。
 */
export interface AgentConfig {
    /** 自訂 system prompt;空走內建 default */
    systemPrompt?: string
    /** 單次對話最多 agentic 步數(stopWhen: stepCountIs(n)) */
    maxTurns: number
    /** 啟動是否進 plan 模式(只讀工具) */
    planMode: boolean
    /** 檔案工具相對路徑錨點 + external_directory 判界基準 */
    workspace: string
    /** 宣告式權限配置(出廠預設,見 docs/19 §5) */
    permission: PermissionConfig
    /** 同一 (tool+input) 連續重複幾次算 doom_loop(防打轉燒錢) */
    doomLoopLimit: number
}

// ─── 對話 / 訊息(對應 agent_messages 表 + renderer 顯示)──────

export type AgentRole = 'user' | 'assistant' | 'tool' | 'system'

/** 一則工具呼叫(assistant 訊息上可帶多個) */
export interface AgentToolCall {
    toolCallId: string
    name: string
    /** 工具入參(JSON) */
    input: unknown
}

/** 一則訊息(渲染端顯示 + DB 持久化的視圖) */
export interface AgentMessage {
    id: string
    conversationId: string
    role: AgentRole
    content: string
    /** 思考鏈(僅 assistant;model 支援 reasoning 時才有) */
    reasoningContent?: string
    /** assistant 發起的工具呼叫 */
    toolCalls?: AgentToolCall[]
    /** tool 訊息對應的 toolCallId */
    toolCallId?: string
    timestamp: number
}

export interface ConversationSummary {
    conversationId: string
    /** 首條 user 訊息截斷作標題,或使用者命名 */
    title: string
    updatedAt: number
    messageCount: number
}
