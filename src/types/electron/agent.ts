/**
 * electronAPI.agent 子介面(docs/19)— 對齊 preload/bridges/agent.bridge.ts。
 * 串流事件不在這裡,走 electronAPI.on(IpcChannels.AGENT_PUSH_*)。
 */
import type {IpcResult as Result} from '@shared/types/ipc.types'
import type {AgentConfig, AgentMessage, ConversationSummary} from '@shared/types/agent.types'

/** config-read 額外帶 isReady(baseUrl+model 是否都配好) */
export type AgentConfigView = AgentConfig & { isReady: boolean }

export interface AgentAPI {
    start: (conversationId: string, userMessage: string, planMode?: boolean) => Promise<Result<{
        messageId: string;
        conversationId: string
    }>>
    interrupt: (conversationId: string) => Promise<Result<boolean>>
    listMessages: (conversationId: string, limit?: number, before?: number) => Promise<Result<AgentMessage[]>>
    listConversations: () => Promise<Result<ConversationSummary[]>>
    newConversation: () => Promise<Result<{ conversationId: string }>>
    forkConversation: (conversationId: string, uptoMessageId: string) => Promise<Result<{ conversationId: string }>>
    deleteConversation: (conversationId: string) => Promise<Result<boolean>>
    configRead: () => Promise<Result<AgentConfigView>>
    configWrite: (partial: Partial<AgentConfig>) => Promise<Result<boolean>>
    listModels: (baseUrl: string, apiKey?: string) => Promise<Result<string[]>>
    testConnection: () => Promise<Result<{ model: string }>>
    permissionRespond: (payload: object) => Promise<Result<boolean>>
}
