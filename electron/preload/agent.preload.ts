/**
 * Agent 獨立窗口 preload。
 *
 * 暴露最小 API:工具執行 + 配置讀寫 + 對話歷史 + 取 auth token(讓渲染端走後端拿 apiKey)。
 *
 * ⚠️ channel 內聯不走 @shared/ipc-channels(跟 log-viewer.preload.ts 同樣理由):
 *   sandbox: true 下 Electron 不解析 chunks/,共用模組會被 Rollup 抽 chunk。
 *
 * 🔗 source of truth:electron/shared/ipc-channels/agent.ts
 */

import {contextBridge, ipcRenderer} from 'electron'

const IPC = {
    AGENT_EXEC_TOOL: 'agent:exec-tool',
    AGENT_READ_CONFIG: 'agent:read-config',
    AGENT_WRITE_CONFIG: 'agent:write-config',
    AGENT_CLEAR_CONFIG: 'agent:clear-config',
    AGENT_LIST_MESSAGES: 'agent:list-messages',
    AGENT_SAVE_MESSAGE: 'agent:save-message',
    AGENT_CLEAR_MESSAGES: 'agent:clear-messages',
    AGENT_LIST_CONVERSATIONS: 'agent:list-conversations',
} as const

interface AgentConfigShape {
    apiKey?: string
    baseUrl?: string
    model?: string
    systemPrompt?: string
    temperature?: number
    maxTurns?: number
}

interface AgentMessageShape {
    id: string
    conversationId: string
    role: 'user' | 'assistant' | 'tool' | 'system'
    content: string | null
    toolCalls?: unknown
    toolCallId?: string
    timestamp: number
}

interface ToolExecResultShape {
    ok: boolean
    content: string
    error?: string
}

contextBridge.exposeInMainWorld('agentAPI', {
    execTool: (name: string, args: Record<string, unknown>) =>
        ipcRenderer.invoke(IPC.AGENT_EXEC_TOOL, {name, args}) as Promise<ToolExecResultShape>,

    readConfig: () =>
        ipcRenderer.invoke(IPC.AGENT_READ_CONFIG) as Promise<AgentConfigShape>,

    writeConfig: (partial: AgentConfigShape) =>
        ipcRenderer.invoke(IPC.AGENT_WRITE_CONFIG, partial) as Promise<boolean>,

    clearConfig: () =>
        ipcRenderer.invoke(IPC.AGENT_CLEAR_CONFIG) as Promise<boolean>,

    listMessages: (conversationId: string, limit?: number) =>
        ipcRenderer.invoke(IPC.AGENT_LIST_MESSAGES, {conversationId, limit}) as Promise<AgentMessageShape[]>,

    saveMessage: (msg: AgentMessageShape) =>
        ipcRenderer.invoke(IPC.AGENT_SAVE_MESSAGE, msg) as Promise<boolean>,

    clearMessages: (conversationId?: string) =>
        ipcRenderer.invoke(IPC.AGENT_CLEAR_MESSAGES, {conversationId}) as Promise<boolean>,

    listConversations: () =>
        ipcRenderer.invoke(IPC.AGENT_LIST_CONVERSATIONS) as Promise<
            Array<{ conversationId: string; title: string; lastTime: number; messageCount: number }>
        >,
})
