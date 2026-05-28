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

/**
 * 單一 LLM 廠商配置(DeepSeek / 通義千問 / OpenAI / 自訂 OpenAI 兼容端點)。
 *
 * 設計動機:
 *   - 同一台機器可能要切換多家供應商(企業內網 + 個人測試)
 *   - 來源預期是 TMBOM 後端(統一發 key),前端只負責落地 + 切換
 *   - 每個 provider 內部記住「上次選用的 model」,切換 provider 不丟 model 選擇
 */
export interface ProviderConfig {
    /** 穩定 ID(後端發來時固定,手動加的用 `custom-${timestamp}`) */
    id: string
    /** 顯示用名稱(「DeepSeek」/「通義千問」/「OpenAI」/ 使用者自訂) */
    label: string
    /** OpenAI 兼容 API 根路徑(例:https://api.deepseek.com、https://dashscope.aliyuncs.com/compatible-mode/v1) */
    baseUrl: string
    /** API Key(明文存在本機 SQLite) */
    apiKey: string
    /** 該 provider 當前選用的 model;為空 → UI 強制使用者挑一個 */
    model?: string
}

/** Agent 配置(寫入 agent_configs 表) */
export interface AgentConfig {
    /**
     * LLM 廠商列表。
     * 為空陣列時,UI 引導使用者添加或從 TMBOM 後端拉取。
     */
    providers?: ProviderConfig[]
    /** 當前選中的 provider ID(對應 providers[].id) */
    activeProviderId?: string
    /** 系統提示詞 */
    systemPrompt?: string
    /** 溫度 0-2 */
    temperature?: number
    /** 單次對話最大輪數 */
    maxTurns?: number

    // ── Thinking 模式(DeepSeek V4 / Claude extended thinking / o1) ──────
    /**
     * 是否啟用 thinking 模式。
     * 啟用後:
     *  - DeepSeek V4 透過 `extra_body.thinking = { type: 'enabled' }` 傳遞
     *  - 回傳的 chunk 內會有 `delta.reasoning_content` 跟 content 平行
     *  - UI 在 assistant 訊息上方顯示 ThinkingBlock 卡片
     * 不啟用時(false / undefined),即使是 V4 也走純 content 路徑。
     */
    thinkingEnabled?: boolean
    /**
     * 思考強度。對應 DeepSeek / OpenAI o-series 的 reasoning_effort 參數。
     *  - 'high':默認,平衡速度與深度
     *  - 'max':Agent 類複雜任務(Claude Code、OpenCode 風格)推薦,代價更高
     * (DeepSeek 文檔指出 low/medium 會映射到 high,所以我們只暴露 high/max 兩擋)
     */
    reasoningEffort?: 'high' | 'max'

    // ── Legacy(1.3.x 單 provider 時代的欄位)──────────────────────────
    // 仍保留讀取,讓既有使用者 SQLite 中的舊資料能被遷移成 providers[0]。
    // 新代碼不要寫入這三個欄位;遷移完成後 AgentService.writeConfig 也不再持久化它們。
    /** @deprecated 用 providers[].apiKey */
    apiKey?: string
    /** @deprecated 用 providers[].baseUrl */
    baseUrl?: string
    /** @deprecated 用 providers[].model */
    model?: string
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
     * 思考鏈內容(僅 assistant 訊息會有,且 thinkingEnabled=true 時才填)。
     * 來源:
     *  - DeepSeek V4 等支援 thinking 的 model,從 stream chunk 的 `delta.reasoning_content` 累積
     *  - 持久化進 DB,跨重啟可看歷史思考
     * 多輪拼接規則(DeepSeek 文檔):
     *  - assistant 沒呼叫工具 → 下一輪不回傳 reasoning_content(API 會忽略)
     *  - assistant 呼叫工具 → 下一輪所有 user 交互輪次必須回傳給 API
     */
    reasoningContent?: string
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
