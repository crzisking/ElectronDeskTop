/**
 * Agent v2 IPC handler(docs/19 §8)— 薄轉發層,業務在 agent/runtime + db-adapter + config-store。
 * 統一回 {ok:true, data} | {ok:false, error}。
 */

import {randomUUID} from 'crypto'
import {ipcMain} from 'electron'
import {generateText} from 'ai'
import {IpcChannels} from '../../shared/ipc-channels'
import type {AgentRuntime} from '../agent/runtime'
import type {AgentConfigStore} from '../agent/config-store'
import type {AgentDbAdapter} from '../agent/db-adapter'
import type {AgentService} from '../db/features/agent/service'
import {buildModel, isAgentReady, listModels, resolveActiveProvider} from '../agent/model-provider'

export interface AgentHandlerDeps {
    runtime: AgentRuntime | null
    configStore: AgentConfigStore | null
    db: AgentDbAdapter | null
    /** 模型連線來源:現有模型設定的 active provider */
    agentService: AgentService | null
}

type Result<T> = { ok: true; data: T } | { ok: false; error: string }

async function safe<T>(fn: () => T | Promise<T>): Promise<Result<T>> {
    try {
        return {ok: true, data: await fn()}
    } catch (err) {
        return {ok: false, error: err instanceof Error ? err.message : String(err)}
    }
}

export function registerAgentHandlers(deps: AgentHandlerDeps): void {
    const ch = IpcChannels
    const notReady = {ok: false as const, error: 'Agent 服務未就緒(DB 未起來)'}

    // ── 對話流程 ──
    ipcMain.handle(ch.AGENT_START, (_e, p: { conversationId?: string; userMessage?: string; planMode?: boolean }) => {
        if (!deps.runtime) return notReady
        const conversationId = p?.conversationId || randomUUID()
        const userMessage = (p?.userMessage ?? '').trim()
        if (!userMessage) return {ok: false, error: '訊息不可為空'}
        const {messageId} = deps.runtime.start({conversationId, userMessage, planMode: !!p?.planMode})
        return {ok: true, data: {messageId, conversationId}}
    })

    ipcMain.handle(ch.AGENT_INTERRUPT, (_e, p: { conversationId?: string }) => {
        if (!deps.runtime) return notReady
        return {ok: true, data: deps.runtime.interrupt(p?.conversationId ?? '')}
    })

    // ── 對話 / 訊息管理 ──
    ipcMain.handle(ch.AGENT_LIST_MESSAGES, (_e, p: { conversationId?: string; limit?: number; before?: number }) => {
        if (!deps.db) return notReady
        return {ok: true, data: deps.db.listMessages(p?.conversationId ?? '', p?.limit, p?.before)}
    })

    ipcMain.handle(ch.AGENT_LIST_CONVERSATIONS, () => {
        if (!deps.db) return notReady
        return {ok: true, data: deps.db.listConversations()}
    })

    ipcMain.handle(ch.AGENT_NEW_CONVERSATION, () => {
        // 不落庫,首條訊息才會建 row
        return {ok: true, data: {conversationId: randomUUID()}}
    })

    ipcMain.handle(ch.AGENT_FORK_CONVERSATION, (_e, p: { conversationId?: string; uptoMessageId?: string }) => {
        if (!deps.db) return notReady
        if (!p?.conversationId || !p?.uptoMessageId) return {ok: false, error: '缺 conversationId / uptoMessageId'}
        return {ok: true, data: {conversationId: deps.db.fork(p.conversationId, p.uptoMessageId)}}
    })

    ipcMain.handle(ch.AGENT_DELETE_CONVERSATION, (_e, p: { conversationId?: string }) => {
        if (!deps.db) return notReady
        if (p?.conversationId) deps.db.deleteConversation(p.conversationId)
        return {ok: true, data: true}
    })

    // ── 配置 + 模型 ──
    ipcMain.handle(ch.AGENT_CONFIG_READ, () => {
        if (!deps.configStore) return notReady
        const cfg = deps.configStore.read()
        // isReady 由現有模型設定的 active provider 決定(baseUrl + model 都配好)
        return {ok: true, data: {...cfg, isReady: isAgentReady(deps.agentService)}}
    })

    ipcMain.handle(ch.AGENT_CONFIG_WRITE, (_e, p: { partial?: Record<string, unknown> }) => {
        if (!deps.configStore) return notReady
        return {ok: true, data: deps.configStore.write((p?.partial ?? {}) as never)}
    })

    // 拉端點 /models 清單(模型設定 UI 選 model 用)
    ipcMain.handle(ch.AGENT_LIST_MODELS, (_e, p: { baseUrl?: string; apiKey?: string }) =>
        safe(() => listModels(p?.baseUrl ?? '', p?.apiKey)))

    // 對 active provider 發極小探針測連線
    ipcMain.handle(ch.AGENT_TEST_CONNECTION, () =>
        safe(async () => {
            const conn = resolveActiveProvider(deps.agentService)
            const model = buildModel(conn)               // conn 為 null 會拋 AgentNotConfiguredError
            await generateText({model, prompt: 'ping'})  // 小探針:能回就算連通
            return {model: conn!.model}
        }))

    // 權限彈框回應(Stage 2 實作;先接通不報錯)
    ipcMain.handle(ch.AGENT_PERMISSION_RESPOND, () => ({ok: true, data: true}))
}
