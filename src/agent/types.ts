/**
 * Agent 窗口內部型別。
 *
 * 跟 electron/main/db/features/agent/service.ts 內的 AgentMessage / AgentConfig 對齊,
 * 但因為 preload 走 contextBridge,渲染端拿到的是 plain object,所以重新定義一份避免
 * 跨進程型別依賴。
 */

export interface AgentConfig {
    /** DeepSeek / OpenAI 兼容 API Key */
    apiKey?: string
    /** API 基址,DeepSeek 預設 https://api.deepseek.com */
    baseUrl?: string
    /** 模型名,DeepSeek 預設 deepseek-chat */
    model?: string
    /** 系統提示詞 */
    systemPrompt?: string
    /** 溫度 0-2 */
    temperature?: number
    /** 單次對話最大輪數 */
    maxTurns?: number
}

export interface OpenAIToolCall {
    id: string
    type: 'function'
    function: {
        name: string
        arguments: string
    }
}

export interface AgentMessage {
    id: string
    conversationId: string
    role: 'user' | 'assistant' | 'tool' | 'system'
    content: string | null
    toolCalls?: OpenAIToolCall[]
    toolCallId?: string
    /** 工具執行結果(僅 UI 展示用,不寫入發給 LLM 的 messages) */
    toolDisplay?: { ok: boolean; preview: string }
    timestamp: number
    /** UI 標記:本輪 streaming 中,渲染為打字機效果 */
    streaming?: boolean
}

export interface ToolExecResult {
    ok: boolean
    content: string
    error?: string
}

export interface ConversationSummary {
    conversationId: string
    title: string
    lastTime: number
    messageCount: number
}

declare global {
    interface Window {
        agentAPI: {
            execTool(name: string, args: Record<string, unknown>): Promise<ToolExecResult>
            readConfig(): Promise<AgentConfig>
            writeConfig(partial: AgentConfig): Promise<boolean>
            clearConfig(): Promise<boolean>
            listMessages(conversationId: string, limit?: number): Promise<AgentMessage[]>
            saveMessage(msg: AgentMessage): Promise<boolean>
            clearMessages(conversationId?: string): Promise<boolean>
            listConversations(): Promise<ConversationSummary[]>
        }
    }
}

export {}
