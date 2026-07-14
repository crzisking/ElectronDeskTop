/**
 * 靈感速記後台 AI 完善佇列(docs/21 §「AI 完善(後台異步)」)。
 *
 * 使用者按 [✨AI完善] 保存後,create 標 RefineStatus='pending' 並把 clientId 丟進本佇列。
 * 佇列單並發、in-memory:讀該筆 → 呼叫 LLM(復用模型設定 active provider)→ 解析 →
 * PATCH .../ai 回寫 → push 通知主窗想法庫刷新。失敗則回寫 failed。
 * app 退出佇列即清(沒跑完停 pending,靠想法庫 [✨完善] 重試)。
 */

import {logger} from '../utils/logger'
import {IpcChannels} from '../../shared/ipc-channels'
import {authContext} from '../services/auth-context'
import {buildRefinePrompt, parseRefineResult} from '../../shared/idea-capture/refine'
import {ideaApi, type IdeaApiContext} from './api-client'
import type {LlmClient} from '../services/llm'
import type {WindowManager} from '../windows/window-manager'
import type {IdeaRefineStatus} from '../../shared/types/idea-capture.types'

const TAG = 'idea.refiner'
const LLM_TIMEOUT_MS = 90_000

export class IdeaRefiner {
    private readonly queue: string[] = []
    private processing = false

    constructor(
        private readonly llm: LlmClient | null,
        private readonly windowManager: WindowManager,
    ) {
    }

    /** 把一筆想法排入完善佇列(去重);閒置就啟動處理 */
    enqueue(clientId: string): void {
        if (!clientId || this.queue.includes(clientId)) return
        this.queue.push(clientId)
        void this.pump()
    }

    private async pump(): Promise<void> {
        if (this.processing) return
        this.processing = true
        try {
            while (this.queue.length) {
                const clientId = this.queue.shift()!
                await this.refineOne(clientId)
            }
        } finally {
            this.processing = false
        }
    }

    private async refineOne(clientId: string): Promise<void> {
        const a = authContext.get()
        if (!a.userId) {
            logger.warn('未登入,略過完善', TAG)
            return
        }
        const ctx: IdeaApiContext = {baseUrl: a.baseUrl, userName: a.userId, token: a.token}

        try {
            if (!this.llm) throw new Error('模型未配置')

            const idea = await ideaApi.detail(ctx, clientId)
            const {system, user} = buildRefinePrompt({
                ideaType: idea.ideaType, content: idea.content, scene: idea.scene, expectation: idea.expectation,
            })
            const {content} = await this.llm.complete({
                messages: [{role: 'system', content: system}, {role: 'user', content: user}],
                responseFormat: 'json_object',
                timeoutMs: LLM_TIMEOUT_MS,
            })
            const result = parseRefineResult(content)
            if (!result) throw new Error('AI 回應解析失敗')

            await ideaApi.applyAi(ctx, clientId, result, 'done')
            this.pushRefined(clientId, 'done')
            logger.info(`完善完成:${clientId}`, TAG)
        } catch (err) {
            logger.warn(`完善失敗 ${clientId}:${(err as Error).message}`, TAG)
            // 盡力回寫 failed,讓想法庫顯示可重試;回寫本身失敗只記 log
            try {
                await ideaApi.applyAi(ctx, clientId, {actionItems: [], aiQuestions: [], tags: []}, 'failed')
            } catch { /* ignore */
            }
            this.pushRefined(clientId, 'failed')
        }
    }

    /** 通知主窗想法庫:某筆完善狀態變了(頁開著就就地刷新) */
    private pushRefined(clientId: string, refineStatus: IdeaRefineStatus): void {
        try {
            this.windowManager.sendToMainWindow(IpcChannels.IDEA_PUSH_REFINED, {clientId, refineStatus})
        } catch { /* 主窗可能已銷毀,忽略 */
        }
    }
}
