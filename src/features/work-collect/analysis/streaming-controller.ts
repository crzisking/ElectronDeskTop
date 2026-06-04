/**
 * Streaming text controller — Vue ↔ vanilla DOM 銜接層,對齊 docs/19 設計。
 *
 * 為什麼不放 Pinia / Vue reactive:
 *   - LLM streaming 速率可達 60-100 token/s
 *   - 每 token 走 Vue reactive → MessageRenderer 重渲 → markdown 重 parse → highlight.js 重跑
 *   - 累積 500 token 訊息可能卡頓 60ms+
 *   - 改純 DOM `textContent +=` ~0.05ms,完全脫出 reactive
 *
 * Dialog 結構:
 *   <div ref="streamRoot" />     ← Vue 提供掛載點
 *      ↓ onMounted 時
 *   new StreamingController(streamRoot.value, runId, eventBus)
 *      ↓ 監聽 PUSH_WORK_ANALYSIS_STREAM,把 delta 直接寫進 <pre>.textContent
 *
 * 結束時 Dialog 呼 finalize(),controller 把 <pre> 留著(streaming 文字仍可見),
 * Dialog 自己再決定要不要切換成「結構化報告」UI(那一段走回 Vue)。
 */

import {IpcChannels} from '@shared/ipc-channels'
import type {EndPushPayload, StreamPushPayload} from '@/types/electron/work-analysis'

/** 結束事件,Dialog 拿來決定下一步(渲報告 / 顯示錯誤) */
export type StreamEndEvent = EndPushPayload

export class StreamingController {
    private streamNode: HTMLPreElement | null = null
    private buf = ''
    private endHandlers: Array<(e: StreamEndEvent) => void> = []
    /** 用 listener 引用 — off() 時要傳同一個 reference 才能清掉 preload 內的 wrapper */
    private readonly onStream: (...args: unknown[]) => void
    private readonly onEnd: (...args: unknown[]) => void
    /** 自動 scroll-bottom flag — 使用者手動上滾後關掉,避免硬把畫面拉下 */
    private autoScroll = true

    constructor(
        private readonly root: HTMLElement,
        private readonly runId: string,
    ) {
        this.onStream = (...args: unknown[]) => {
            const payload = args[0] as StreamPushPayload | undefined
            if (!payload || payload.runId !== this.runId) return
            this.appendDelta(payload.delta)
        }
        this.onEnd = (...args: unknown[]) => {
            const payload = args[0] as StreamEndEvent | undefined
            if (!payload || payload.runId !== this.runId) return
            this.endHandlers.forEach((h) => h(payload))
        }
        window.electronAPI.on(IpcChannels.PUSH_WORK_ANALYSIS_STREAM, this.onStream)
        window.electronAPI.on(IpcChannels.PUSH_WORK_ANALYSIS_END, this.onEnd)

        // 監聽 root scroll,使用者手動往上 → 停止 auto-scroll(尊重閱讀位置)
        this.root.addEventListener('scroll', this.handleScroll, {passive: true})
    }

    /** 註冊 end 事件回調(可多個);返回 unsub */
    onceEnd(handler: (e: StreamEndEvent) => void): () => void {
        this.endHandlers.push(handler)
        return () => {
            this.endHandlers = this.endHandlers.filter((h) => h !== handler)
        }
    }

    /** 對外查詢:目前累積到的文字(Dialog 結束時要拿來判斷是否要切結構化視圖) */
    getBuffer(): string {
        return this.buf
    }

    /** 切斷監聽 — Dialog onUnmounted 時呼,避免 PUSH 殘留 wrapper */
    dispose(): void {
        window.electronAPI.off(IpcChannels.PUSH_WORK_ANALYSIS_STREAM, this.onStream)
        window.electronAPI.off(IpcChannels.PUSH_WORK_ANALYSIS_END, this.onEnd)
        this.root.removeEventListener('scroll', this.handleScroll)
        this.endHandlers = []
        this.streamNode = null
    }

    private appendDelta(delta: string): void {
        if (!this.streamNode) {
            this.streamNode = document.createElement('pre')
            this.streamNode.className = 'stream-text'
            this.root.appendChild(this.streamNode)
        }
        this.buf += delta
        // ⚡ 純 DOM mutation,~0.05ms,不觸發 Vue reactive
        this.streamNode.textContent = this.buf
        if (this.autoScroll) {
            // 不用 smooth scroll,token 速率高時 smooth 反而卡;直接 jump
            this.root.scrollTop = this.root.scrollHeight
        }
    }

    private readonly handleScroll = () => {
        // 計算「離底部還有多遠」— ≤ 8px 視為「黏在底部」,否則使用者上滾了
        const gap = this.root.scrollHeight - this.root.scrollTop - this.root.clientHeight
        this.autoScroll = gap <= 8
    }
}
