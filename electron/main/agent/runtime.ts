/**
 * Agent v2 執行內核(docs/19 §4.3)。
 *
 * 用 Vercel AI SDK v7 的 `streamText` + `stopWhen: stepCountIs(maxTurns)` 跑 agentic 迴圈
 * (串流解析 / 工具呼叫拼裝 / 多輪循環由 SDK 接手)。本類負責:
 *   配置就緒判斷 → 灌歷史 messages(resume)→ 落 user 訊息 → 跑串流(fullStream → EventBridge)
 *   → 用 response.messages 一次落庫 assistant / tool 訊息。
 *
 * 同一時間單一 run:新請求會 abort 舊的。Stage 1 用最小工具集(read + bash),
 * 權限 gate(§5)/ plan mode(§6.2)/ 完整工具(§6.1 移植 opencode)留待 Stage 2/3。
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
import type {AgentService} from '../db/features/agent/service'

const TAG = 'AgentRuntime'

const DEFAULT_SYSTEM_PROMPT =
    '你是內部桌面工具的 AI 助理,運行在使用者的 Windows 電腦上。' +
    '你可以讀檔案、執行 shell 命令來完成任務。回答精簡、實事求是;不確定就說不確定。'

export interface StartOpts {
    conversationId: string
    userMessage: string
    planMode?: boolean
}

export class AgentRuntime {
    private current: { conversationId: string; abort: AbortController } | null = null

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

            // 落 user 訊息
            const userTs = Date.now()
            this.db.append({
                id: randomUUID(), conversationId: opts.conversationId,
                role: 'user', content: opts.userMessage, timestamp: userTs,
            })

            const result = streamText({
                model,
                system: cfg.systemPrompt || DEFAULT_SYSTEM_PROMPT,
                messages: [...rowsToModelMessages(history), {role: 'user', content: opts.userMessage}],
                tools: buildTools(cfg),
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
            if (this.current?.abort === abort) this.current = null
        }
    }
}
