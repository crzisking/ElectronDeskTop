/**
 * Agent v2 IPC channels(docs/19 §8)。
 * AGENT_* = renderer → main invoke;AGENT_PUSH_* = main → renderer push(串流事件)。
 */
export const AgentChannels = {
    // ── invoke ──
    AGENT_START: 'agent:start',
    AGENT_INTERRUPT: 'agent:interrupt',
    AGENT_LIST_MESSAGES: 'agent:list-messages',
    AGENT_LIST_CONVERSATIONS: 'agent:list-conversations',
    AGENT_NEW_CONVERSATION: 'agent:new-conversation',
    AGENT_FORK_CONVERSATION: 'agent:fork-conversation',
    AGENT_DELETE_CONVERSATION: 'agent:delete-conversation',
    AGENT_CONFIG_READ: 'agent:config-read',
    AGENT_CONFIG_WRITE: 'agent:config-write',
    /** 配好 URL 後拉端點 /models 清單(供設定頁選 model) */
    AGENT_LIST_MODELS: 'agent:list-models',
    /** 對已配置的 URL+model 發小探針測連線 */
    AGENT_TEST_CONNECTION: 'agent:test-connection',
    /** 權限彈框的回應(Stage 2 用) */
    AGENT_PERMISSION_RESPOND: 'agent:permission-respond',

    // ── push(main → renderer)──
    AGENT_PUSH_STREAM: 'agent:push:stream',
    AGENT_PUSH_TOOL_USE: 'agent:push:tool-use',
    AGENT_PUSH_TOOL_RESULT: 'agent:push:tool-result',
    AGENT_PUSH_END: 'agent:push:end',
    AGENT_PUSH_PERMISSION_ASK: 'agent:push:permission-ask',
    AGENT_PUSH_ERROR: 'agent:push:error',
} as const
