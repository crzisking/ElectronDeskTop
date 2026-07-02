/**
 * Agent v2 bridge(docs/19 §8)。renderer 對 main agent 後端的入口。
 * 統一回 {ok, data} | {ok, error}(對齊 handler)。串流事件走 electronAPI.on(AGENT_PUSH_*)。
 */
import type {IpcRenderer} from 'electron'
import type {IpcResult as Result} from '@shared/types/ipc.types'

export interface AgentChannelMap {
    [key: string]: string
}

export function createAgentBridge(ipc: IpcRenderer, ch: AgentChannelMap) {
    const c = (action: string, args: object = {}) => ipc.invoke(action, args)
    return {
        start: (conversationId: string, userMessage: string, planMode = false) =>
            c(ch.AGENT_START, {conversationId, userMessage, planMode}) as Promise<Result<{
                messageId: string;
                conversationId: string
            }>>,
        interrupt: (conversationId: string) =>
            c(ch.AGENT_INTERRUPT, {conversationId}) as Promise<Result<boolean>>,
        listMessages: (conversationId: string, limit?: number, before?: number) =>
            c(ch.AGENT_LIST_MESSAGES, {conversationId, limit, before}) as Promise<Result<unknown>>,
        listConversations: () =>
            c(ch.AGENT_LIST_CONVERSATIONS) as Promise<Result<unknown>>,
        newConversation: (workspace?: string) =>
            c(ch.AGENT_NEW_CONVERSATION, {workspace}) as Promise<Result<{
                conversationId: string;
                workspaces: string[]
            }>>,
        pickWorkspace: () =>
            c(ch.AGENT_PICK_WORKSPACE) as Promise<Result<{ path: string | null }>>,
        setWorkspaces: (conversationId: string, workspaces: string[]) =>
            c(ch.AGENT_SET_WORKSPACES, {conversationId, workspaces}) as Promise<Result<{ workspaces: string[] }>>,
        forkConversation: (conversationId: string, uptoMessageId: string) =>
            c(ch.AGENT_FORK_CONVERSATION, {conversationId, uptoMessageId}) as Promise<Result<{
                conversationId: string
            }>>,
        deleteConversation: (conversationId: string) =>
            c(ch.AGENT_DELETE_CONVERSATION, {conversationId}) as Promise<Result<boolean>>,
        configRead: () =>
            c(ch.AGENT_CONFIG_READ) as Promise<Result<unknown>>,
        configWrite: (partial: object) =>
            c(ch.AGENT_CONFIG_WRITE, {partial}) as Promise<Result<boolean>>,
        listModels: (baseUrl: string, apiKey?: string) =>
            c(ch.AGENT_LIST_MODELS, {baseUrl, apiKey}) as Promise<Result<string[]>>,
        testConnection: () =>
            c(ch.AGENT_TEST_CONNECTION) as Promise<Result<{ model: string }>>,
        permissionRespond: (approvalId: string, decision: string, pattern?: string) =>
            c(ch.AGENT_PERMISSION_RESPOND, {approvalId, decision, pattern}) as Promise<Result<boolean>>,
    }
}
