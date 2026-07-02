/**
 * AI Agent 獨立視窗 preload(docs/19)。
 *
 * 暴露:
 *   - electronAPI.agent.*:對 main agent 後端的 invoke(start/interrupt/config/list…)
 *   - electronAPI.on/off:訂閱 AGENT_PUSH_*(串流 / 工具 / 結束 / 錯誤)
 *
 * ⚠️ channel 字串內聯(不 import @shared 常數):sandbox: true 下共用模組會被 Rollup 抽 chunk,
 *   照 memos.preload / log-viewer 同樣處理。下方 satisfies 對 AgentChannels 做編譯期 drift 防護。
 */

import {contextBridge, ipcRenderer} from 'electron'
import type {AgentChannels} from '../shared/ipc-channels/agent'

const IPC = {
    AGENT_START: 'agent:start',
    AGENT_INTERRUPT: 'agent:interrupt',
    AGENT_LIST_MESSAGES: 'agent:list-messages',
    AGENT_LIST_CONVERSATIONS: 'agent:list-conversations',
    AGENT_NEW_CONVERSATION: 'agent:new-conversation',
    AGENT_PICK_WORKSPACE: 'agent:pick-workspace',
    AGENT_SET_WORKSPACES: 'agent:set-workspaces',
    AGENT_FORK_CONVERSATION: 'agent:fork-conversation',
    AGENT_DELETE_CONVERSATION: 'agent:delete-conversation',
    AGENT_CONFIG_READ: 'agent:config-read',
    AGENT_CONFIG_WRITE: 'agent:config-write',
    AGENT_LIST_MODELS: 'agent:list-models',
    AGENT_TEST_CONNECTION: 'agent:test-connection',
    AGENT_PERMISSION_RESPOND: 'agent:permission-respond',
    AGENT_PUSH_STREAM: 'agent:push:stream',
    AGENT_PUSH_TOOL_USE: 'agent:push:tool-use',
    AGENT_PUSH_TOOL_RESULT: 'agent:push:tool-result',
    AGENT_PUSH_END: 'agent:push:end',
    AGENT_PUSH_PERMISSION_ASK: 'agent:push:permission-ask',
    AGENT_PUSH_ERROR: 'agent:push:error',
} as const

// 編譯期 drift 防護:每個 value 必須是 AgentChannels 裡的字串;改了任一邊 typecheck 報錯
type SharedChannelValue = (typeof AgentChannels)[keyof typeof AgentChannels]
type _AssertChannelsExist = { [K in keyof typeof IPC]: (typeof IPC)[K] & SharedChannelValue }
const _channelCheck: _AssertChannelsExist = IPC
void _channelCheck

const ALLOWED_PUSH_CHANNELS: readonly string[] = [
    IPC.AGENT_PUSH_STREAM,
    IPC.AGENT_PUSH_TOOL_USE,
    IPC.AGENT_PUSH_TOOL_RESULT,
    IPC.AGENT_PUSH_END,
    IPC.AGENT_PUSH_PERMISSION_ASK,
    IPC.AGENT_PUSH_ERROR,
]

type Result<T> = { ok: true; data: T } | { ok: false; error: string }
const c = <T = unknown>(action: string, args: object = {}) =>
    ipcRenderer.invoke(action, args) as Promise<Result<T>>

const listenerMap = new WeakMap<(...a: unknown[]) => void, (e: Electron.IpcRendererEvent, ...a: unknown[]) => void>()

contextBridge.exposeInMainWorld('electronAPI', {
    agent: {
        start: (conversationId: string, userMessage: string, planMode = false) =>
            c(IPC.AGENT_START, {conversationId, userMessage, planMode}),
        interrupt: (conversationId: string) => c(IPC.AGENT_INTERRUPT, {conversationId}),
        listMessages: (conversationId: string, limit?: number, before?: number) =>
            c(IPC.AGENT_LIST_MESSAGES, {conversationId, limit, before}),
        listConversations: () => c(IPC.AGENT_LIST_CONVERSATIONS),
        newConversation: (workspace?: string) => c(IPC.AGENT_NEW_CONVERSATION, {workspace}),
        pickWorkspace: () => c(IPC.AGENT_PICK_WORKSPACE),
        setWorkspaces: (conversationId: string, workspaces: string[]) =>
            c(IPC.AGENT_SET_WORKSPACES, {conversationId, workspaces}),
        forkConversation: (conversationId: string, uptoMessageId: string) =>
            c(IPC.AGENT_FORK_CONVERSATION, {conversationId, uptoMessageId}),
        deleteConversation: (conversationId: string) => c(IPC.AGENT_DELETE_CONVERSATION, {conversationId}),
        configRead: () => c(IPC.AGENT_CONFIG_READ),
        configWrite: (partial: object) => c(IPC.AGENT_CONFIG_WRITE, {partial}),
        listModels: (baseUrl: string, apiKey?: string) => c(IPC.AGENT_LIST_MODELS, {baseUrl, apiKey}),
        testConnection: () => c(IPC.AGENT_TEST_CONNECTION),
        permissionRespond: (approvalId: string, decision: string, pattern?: string) =>
            c(IPC.AGENT_PERMISSION_RESPOND, {approvalId, decision, pattern}),
    },

    on(channel: string, callback: (...args: unknown[]) => void) {
        if (!ALLOWED_PUSH_CHANNELS.includes(channel)) return
        const existing = listenerMap.get(callback)
        if (existing) ipcRenderer.off(channel, existing)
        const wrapper = (_e: Electron.IpcRendererEvent, ...args: unknown[]) => callback(...args)
        listenerMap.set(callback, wrapper)
        ipcRenderer.on(channel, wrapper)
    },
    off(channel: string, callback: (...args: unknown[]) => void) {
        const wrapper = listenerMap.get(callback)
        if (wrapper) {
            ipcRenderer.off(channel, wrapper)
            listenerMap.delete(callback)
        }
    },
})
