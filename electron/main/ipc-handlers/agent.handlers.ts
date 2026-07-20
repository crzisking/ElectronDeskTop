/**
 * Agent v2 IPC handler(docs/19 §8)— 薄轉發層,業務在 agent/runtime + db-adapter + config-store。
 * 統一回 {ok:true, data} | {ok:false, error}。
 */

import {randomUUID} from 'crypto'
import {dialog, ipcMain} from 'electron'
import {generateText} from 'ai'
import {IpcChannels} from '../../shared/ipc-channels'
import type {AgentRuntime} from '../agent/runtime'
import type {AgentConfigStore} from '../agent/config-store'
import type {AgentDbAdapter} from '../agent/db-adapter'
import type {AgentService} from '../db/features/agent/service'
import type {WindowManager} from '../windows/window-manager'
import {buildModel, isAgentReady, listModels, resolveActiveProvider} from '../agent/model-provider'
import {safeRun as safe} from '../utils/ipc-result'

export interface AgentHandlerDeps {
    runtime: AgentRuntime | null
    configStore: AgentConfigStore | null
    db: AgentDbAdapter | null
    /** 模型連線來源:現有模型設定的 active provider */
    agentService: AgentService | null
    /** 資料夾選擇器要用(dialog 的 parent 視窗) */
    windowManager: WindowManager | null
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
        const list = deps.db.listConversations().map((c) => ({
            ...c,
            workspaces: deps.configStore?.getConversationWorkspaces(c.conversationId) ?? [],
        }))
        return {ok: true, data: list}
    })

    // 新對話:綁工作資料夾(可多個,新建時先給一個);不落庫,首條訊息才建 row。
    ipcMain.handle(ch.AGENT_NEW_CONVERSATION, (_e, p: { workspace?: string }) => {
        const conversationId = randomUUID()
        const picked = p?.workspace?.trim()
        const workspaces = picked ? [picked] : []
        if (workspaces.length && deps.configStore) deps.configStore.setConversationWorkspaces(conversationId, workspaces)
        return {ok: true, data: {conversationId, workspaces}}
    })

    // 設定某對話的工作資料夾清單(加 / 移除後持久化);回最新清單
    ipcMain.handle(ch.AGENT_SET_WORKSPACES, (_e, p: { conversationId?: string; workspaces?: string[] }) => {
        if (!deps.configStore || !p?.conversationId) return {ok: false, error: '缺 conversationId'}
        const ws = Array.isArray(p.workspaces) ? p.workspaces.filter((w) => typeof w === 'string' && w) : []
        deps.configStore.setConversationWorkspaces(p.conversationId, ws)
        return {ok: true, data: {workspaces: deps.configStore.getConversationWorkspaces(p.conversationId)}}
    })

    // 開資料夾選擇器,回選中的工作目錄(取消回 null)
    ipcMain.handle(ch.AGENT_PICK_WORKSPACE, async () => {
        const win = deps.windowManager?.getAgentWindow() ?? undefined
        const opts = {properties: ['openDirectory' as const]}
        const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
        return {ok: true, data: {path: r.canceled || !r.filePaths.length ? null : r.filePaths[0]}}
    })

    ipcMain.handle(ch.AGENT_DELETE_CONVERSATION, (_e, p: { conversationId?: string }) => {
        if (!deps.db) return notReady
        if (p?.conversationId) {
            deps.db.deleteConversation(p.conversationId)
            deps.configStore?.clearConversationWorkspace(p.conversationId)
            deps.configStore?.clearConversationSummary(p.conversationId)
        }
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

    // 權限彈框回應 → 解決 runtime 裡等待的 promise(§5)
    ipcMain.handle(ch.AGENT_PERMISSION_RESPOND, (_e, p: {
        approvalId?: string;
        decision?: string;
        pattern?: string
    }) => {
        if (!deps.runtime || !p?.approvalId || !p?.decision) return {ok: false, error: '缺 approvalId / decision'}
        return {ok: true, data: deps.runtime.respondPermission(p.approvalId, p.decision, p.pattern)}
    })
}
