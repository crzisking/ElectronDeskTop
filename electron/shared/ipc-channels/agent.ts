/**
 * Agent 功能相關 IPC channels。
 *
 * Agent 在獨立 BrowserWindow 中運行,渲染端透過這些頻道:
 *  - 從主進程查/寫 API Key 配置(SQLite agent_configs 表)
 *  - 執行需要 Node.js 能力的系統工具(open_app / read_file / run_command 等)
 *  - 讀寫對話歷史(agent_messages 表)
 *
 * 另有兩個 channel 給其他窗口觸發 Agent 窗口開啟:
 *  - AGENT_OPEN_WINDOW:浮球右鍵菜單 / 主窗按鈕 → 主進程開窗
 */
export const AgentChannels = {
    /** AGENT_OPEN_WINDOW:任意窗口觸發開啟 Agent 獨立窗口。send */
    AGENT_OPEN_WINDOW: 'agent:open-window',

    /** AGENT_EXEC_TOOL:渲染端執行需 Node.js 能力的系統工具。invoke。payload: { name, args } */
    AGENT_EXEC_TOOL: 'agent:exec-tool',

    /** AGENT_READ_CONFIG:從 SQLite 讀取 API Key / baseUrl / model / 等配置。invoke。返回:AgentConfig | null */
    AGENT_READ_CONFIG: 'agent:read-config',

    /** AGENT_WRITE_CONFIG:寫入配置到 SQLite。invoke。payload: Partial<AgentConfig> */
    AGENT_WRITE_CONFIG: 'agent:write-config',

    /** AGENT_CLEAR_CONFIG:清空 API Key(401 時觸發重新獲取)。invoke */
    AGENT_CLEAR_CONFIG: 'agent:clear-config',

    /** AGENT_LIST_MESSAGES:列出對話歷史。invoke。payload: { conversationId?, limit? } */
    AGENT_LIST_MESSAGES: 'agent:list-messages',

    /** AGENT_SAVE_MESSAGE:保存單條消息。invoke。payload: AgentMessage */
    AGENT_SAVE_MESSAGE: 'agent:save-message',

    /** AGENT_CLEAR_MESSAGES:清空對話。invoke。payload: { conversationId? } */
    AGENT_CLEAR_MESSAGES: 'agent:clear-messages',

    /** AGENT_LIST_CONVERSATIONS:列出所有對話(給左側對話列表)。invoke。返回:Array<{conversationId, title, lastTime, messageCount}> */
    AGENT_LIST_CONVERSATIONS: 'agent:list-conversations',
} as const
