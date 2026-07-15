/**
 * Agent 視窗 ↔ main 的 API 包裝層。
 *
 * envelope 拆包走共用 `unwrapIpc`(取代原 App.vue 內自寫的 `call<T>`);
 * 每個 method 對應 electronAPI.agent 的一個端點,成功回 data、失敗拋 Error。
 */
import {unwrapIpc} from '@/shared/utils/ipc'
import type {ConversationSummary} from '@shared/types/agent.types'
import type {AgentConfigView} from '@/types/electron/agent'
import type {RawRow} from './types'

const api = () => window.electronAPI.agent

export const agentApi = {
    configRead: () => unwrapIpc<AgentConfigView>(api().configRead()),
    listConversations: () => unwrapIpc<ConversationSummary[]>(api().listConversations()),
    /** DB 訊息行;調用端把它當 RawRow[](只取 user/assistant 渲染) */
    listMessages: (id: string, limit: number, before?: number) =>
        unwrapIpc<RawRow[]>(api().listMessages(id, limit, before)),
    pickWorkspace: () => unwrapIpc<{ path: string | null }>(api().pickWorkspace()),
    newConversation: (workspace: string) =>
        unwrapIpc<{ conversationId: string; workspaces: string[] }>(api().newConversation(workspace)),
    setWorkspaces: (id: string, workspaces: string[]) =>
        unwrapIpc<{ workspaces: string[] }>(api().setWorkspaces(id, workspaces)),
    deleteConversation: (id: string) => unwrapIpc<boolean>(api().deleteConversation(id)),
    start: (id: string, text: string) =>
        unwrapIpc<{ messageId: string; conversationId: string }>(api().start(id, text)),
    /** 中止 / 權限回覆:結果不需要,調用端 fire-and-forget */
    interrupt: (id: string) => api().interrupt(id),
    permissionRespond: (approvalId: string, decision: string, pattern?: string) =>
        api().permissionRespond(approvalId, decision, pattern),
}
