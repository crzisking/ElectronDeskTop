/**
 * Agent v2 執行內核(docs/19 §4.3)。
 *
 * 用 Vercel AI SDK v7 的 `streamText` + `stopWhen: stepCountIs(maxTurns)` 跑 agentic 迴圈
 * (串流解析 / 工具呼叫拼裝 / 多輪循環由 SDK 接手)。本類負責:
 *   配置就緒判斷 → 灌歷史 messages(resume)→ 落 user 訊息 → 跑串流(fullStream → EventBridge)
 *   → 用 response.messages 一次落庫 assistant / tool 訊息。
 *
 * 同一時間單一 run:新請求會 abort 舊的。工具經權限 gate 包裹(§5:allow/ask/deny +
 * doom_loop + external_directory),依對話綁定的工作資料夾清單運作。
 */

import {randomUUID} from 'crypto'
import {stepCountIs, streamText} from 'ai'
import {logger} from '../utils/logger'
import type {AgentConfigStore} from './config-store'
import type {AgentDbAdapter} from './db-adapter'
import type {AgentEventBridge} from './event-bridge'
import {buildModel, resolveActiveProvider} from './model-provider'
import {buildTools} from './tools'
import {responseMessagesToRows, rowsToModelMessages} from './message-mapper'
import {buildSystemPrompt, BUILTIN_BASE, gatherEnv, readRules} from './prompts'
import {type AskRequest, type UserDecision, wrapToolsWithPermission} from './permission'
import type {PermissionVerdict} from '../../shared/types/agent.types'
import type {AgentService} from '../db/features/agent/service'

const TAG = 'AgentRuntime'

export interface StartOpts {
    conversationId: string
    userMessage: string
    planMode?: boolean
}

export class AgentRuntime {
    private current: { conversationId: string; abort: AbortController } | null = null
    /** 待回應的權限彈框:approvalId → resolve;由 respondPermission 解決 */
    private readonly pending = new Map<string, (d: UserDecision) => void>()

    constructor(
        private readonly configStore: AgentConfigStore,
        private readonly db: AgentDbAdapter,
        private readonly events: AgentEventBridge,
        /** 模型連線來源:現有「模型設定」的 active provider */
        private readonly agentService: AgentService | null,
    ) {
    }

    /**
     * 跑一輪對話。**立即回** 本輪 assistant 訊息 id(串流氣泡用),實際串流在背景跑
     * (透過 EventBridge 推 IPC),不阻塞 IPC invoke。
     */
    start(opts: StartOpts): { messageId: string } {
        if (this.current) this.current.abort.abort()
        const abort = new AbortController()
        this.current = {conversationId: opts.conversationId, abort}
        const messageId = randomUUID()
        void this.run(opts, messageId, abort)
        return {messageId}
    }

    /** 中斷指定對話的 run;回是否有 run 被中斷 */
    interrupt(conversationId: string): boolean {
        if (this.current?.conversationId !== conversationId) return false
        this.current.abort.abort()
        return true
    }

    /** renderer 回應權限彈框(decision: allow-once / allow-always / deny-once / deny-always) */
    respondPermission(approvalId: string, decision: string, pattern?: string): boolean {
        const resolve = this.pending.get(approvalId)
        if (!resolve) return false
        this.pending.delete(approvalId)
        resolve({allow: decision.startsWith('allow'), always: decision.endsWith('always'), pattern})
        return true
    }

    /** 把 always 規則寫回 permission 配置(bash 進 bash 子表;其餘設整個工具) */
    private persistRule(tool: string, pattern: string, verdict: PermissionVerdict): void {
        const perm = {...this.configStore.read().permission}
        if (tool === 'bash') {
            const b = perm.bash && typeof perm.bash === 'object' ? {...perm.bash} : {}
            b[pattern] = verdict
            perm.bash = b
        } else {
            perm[tool] = verdict
        }
        this.configStore.write({permission: perm})
    }

    private async run(opts: StartOpts, messageId: string, abort: AbortController): Promise<void> {
        const cfg = this.configStore.read()
        const conn = resolveActiveProvider(this.agentService)

        // 未配置 → 推錯誤引導去模型設定(agent 不可用,唯一不學 opencode 之處:無預設 model)
        if (!conn) {
            this.events.pushError(opts.conversationId, new Error('尚未配置模型:請先到「模型設定」配置 provider(URL + model)'))
            if (this.current?.abort === abort) this.current = null
            return
        }

        try {
            const model = buildModel(conn)
            const history = this.db.listMessages(opts.conversationId)

            // 該對話綁定的工作資料夾清單(可多個,第一個為主目錄);沒綁走預設。
            const bound = this.configStore.getConversationWorkspaces(opts.conversationId)
            const workspaces = bound.length ? bound : [cfg.workspace]

            // 組系統提示:基礎(可被 cfg.systemPrompt 覆蓋)+ 環境注入 + AGENTS.md 專案規則(讀主目錄的)
            const [env, rules] = await Promise.all([gatherEnv(workspaces), readRules(workspaces[0])])
            const system = buildSystemPrompt(cfg.systemPrompt || BUILTIN_BASE, env, rules)

            // 權限 gate:包住工具 execute;ask 走 IPC 彈框等使用者,always 寫回配置(§5)
            const ask = (req: AskRequest): Promise<UserDecision> =>
                new Promise((resolve) => {
                    const approvalId = randomUUID()
                    this.pending.set(approvalId, resolve)
                    this.events.pushPermissionAsk(opts.conversationId, {
                        approvalId,
                        tool: req.tool,
                        subject: req.subject,
                        input: req.input,
                        suggestedPattern: req.suggestedPattern,
                    })
                })
            const tools = wrapToolsWithPermission(buildTools(workspaces), {
                config: cfg.permission,
                workspaces,
                planMode: cfg.planMode || !!opts.planMode,
                doomLoopLimit: cfg.doomLoopLimit,
                ask,
                persist: (tool, pattern, verdict) => this.persistRule(tool, pattern, verdict),
            })

            // 落 user 訊息
            const userTs = Date.now()
            this.db.append({
                id: randomUUID(), conversationId: opts.conversationId,
                role: 'user', content: opts.userMessage, timestamp: userTs,
            })

            const result = streamText({
                model,
                system,
                messages: [...rowsToModelMessages(history), {role: 'user', content: opts.userMessage}],
                tools,
                stopWhen: stepCountIs(cfg.maxTurns),
                abortSignal: abort.signal,
            })

            for await (const part of result.fullStream) {
                this.events.handlePart(part, {conversationId: opts.conversationId, messageId})
            }

            // 用 SDK 產出的 response messages 一次落庫(assistant + tool)
            const resp = await result.response
            const rows = responseMessagesToRows(opts.conversationId, resp.messages, userTs + 1)
            for (const r of rows) this.db.append(r)
        } catch (err) {
            if (!abort.signal.aborted) {
                logger.error('agent run 失敗', TAG, err)
                this.events.pushError(opts.conversationId, err)
            }
        } finally {
            // run 結束 / 中斷:未回應的彈框一律當拒絕,避免 promise 懸掛
            for (const [id, resolve] of this.pending) {
                resolve({allow: false, always: false})
                this.pending.delete(id)
            }
            if (this.current?.abort === abort) this.current = null
        }
    }
}
