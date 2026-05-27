/**
 * Agent 功能跨進程共用型別。
 *
 * 主進程(electron/main/db/features/agent/service.ts、ipc-handlers/agent.handlers.ts)
 * 與渲染端(src/agent/...)都從這裡 import。
 *
 * 為何敢跨進程共用:
 *  - 這些 interface 是純 TypeScript 型別,**沒有 runtime 物件 / 類別實例**,
 *    contextBridge 不會碰到序列化問題
 *  - preload 透過 ipcRenderer.invoke 傳輸的本來就是 plain object,雙方按同一份型別解讀即可
 *
 * 之前的兩份定義(主進程 service.ts 內的 + 渲染端 src/agent/types.ts 內的)
 * 是手動同步的,改一邊忘另一邊容易爆 bug。統一從這裡走 single source of truth。
 */

/** Agent 配置(寫入 agent_configs 表) */
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

/** OpenAI Function Calling 的 tool_call 物件結構 */
export interface OpenAIToolCall {
    id: string
    type: 'function'
    function: {
        name: string
        arguments: string
    }
}

/** Agent 對話消息(寫入 agent_messages 表;渲染端的展示模型) */
export interface AgentMessage {
    id: string
    conversationId: string
    role: 'user' | 'assistant' | 'tool' | 'system'
    content: string | null
    /**
     * LLM 的 function calling 請求(僅 assistant 訊息會有)。
     * 主進程在 service 內部 JSON.stringify 後存進 DB,讀出時再 parse 回物件 ——
     * 介面邊界永遠是物件形式,字串化是 service 實作細節,不污染型別。
     */
    toolCalls?: OpenAIToolCall[]
    /** tool role 消息對應的 tool_call_id */
    toolCallId?: string
    /** Unix ms */
    timestamp: number
    /** 工具執行結果(僅 UI 展示用,不寫入發給 LLM 的 messages、也不寫進 DB) */
    toolDisplay?: { ok: boolean; preview: string }
    /** UI 標記:本輪 streaming 中,渲染為打字機效果(不寫進 DB) */
    streaming?: boolean
}

/** 工具執行結果(IPC AGENT_EXEC_TOOL 的返回型別) */
export interface ToolExecResult {
    ok: boolean
    content: string
    error?: string
}

/** 對話列表 entry(IPC AGENT_LIST_CONVERSATIONS 的返回型別) */
export interface ConversationSummary {
    conversationId: string
    title: string
    lastTime: number
    messageCount: number
}
