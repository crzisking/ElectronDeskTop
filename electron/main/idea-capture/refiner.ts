/**
 * 靈感速記 AI 完善佇列(docs/21)。
 *
 * ⚠️ AI 計算在**後端**跑(後端 Qwen),不走桌面端本地模型配置。本佇列只是「非同步驅動 + 推送」:
 * 使用者按 [✨AI完善] 保存後不等待,佇列在背景呼叫後端 /refine(後端同步跑 Qwen),
 * 完成後 push 通知主窗想法庫刷新徽章。單並發、in-memory;app 退出即清(沒跑完停 pending,靠重試)。
 */

import {logger} from '../utils/logger'
import {IpcChannels} from '../../shared/ipc-channels'
import {authContext} from '../services/auth-context'
import {ideaApi, type IdeaApiContext} from './api-client'
import type {WindowManager} from '../windows/window-manager'
import type {IdeaRefineStatus} from '../../shared/types/idea-capture.types'

const TAG = 'idea.refiner'

export class IdeaRefiner {
    private readonly queue: string[] = []
    private processing = false

    constructor(private readonly windowManager: WindowManager) {
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

        let status: IdeaRefineStatus = 'failed'
        try {
            // 後端同步跑 Qwen 並回寫;這裡只拿最終狀態
            status = await ideaApi.refine(ctx, clientId)
            logger.info(`完善 ${clientId} → ${status}`, TAG)
        } catch (err) {
            logger.warn(`完善失敗 ${clientId}:${(err as Error).message}`, TAG)
            status = 'failed'
        }
        this.pushRefined(clientId, status)
    }

    /** 通知主窗想法庫:某筆完善狀態變了(頁開著就就地刷新) */
    private pushRefined(clientId: string, refineStatus: IdeaRefineStatus): void {
        try {
            this.windowManager.sendToMainWindow(IpcChannels.IDEA_PUSH_REFINED, {clientId, refineStatus})
        } catch { /* 主窗可能已銷毀,忽略 */
        }
    }
}
