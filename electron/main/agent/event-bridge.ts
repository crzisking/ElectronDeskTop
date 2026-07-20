/**
 * Agent v2 事件橋(docs/19 §4.4)。
 * 把 AI SDK `streamText` 的 fullStream part 適配成 IPC push,推給 renderer 即時渲染。
 * 只負責推送;DB 持久化在 runtime 用 response.messages 一次落庫(見 runtime.ts)。
 */

import {IpcChannels} from '../../shared/ipc-channels'
import {logger} from '../utils/logger'
import type {WindowManager} from '../windows/window-manager'

const TAG = 'AgentEventBridge'

/** 串流時每則 part 所屬的上下文 */
export interface RunContext {
    conversationId: string
    /** 本輪 assistant 訊息 id(renderer 據此把 delta 累積到同一個氣泡) */
    messageId: string
}

/** fullStream part 的最小視圖(避免綁死 SDK 泛型聯合;按 type 分流取值) */
interface StreamPart {
    type: string
    text?: string
    toolCallId?: string
    toolName?: string
    input?: unknown
    output?: unknown
    error?: unknown
    finishReason?: string
}

export class AgentEventBridge {
    constructor(private readonly winMgr: WindowManager) {
    }

    /**
     * 串流 delta 合併緩衝。高吞吐模型每秒吐數百個 token,每個 delta 一次 webContents.send
     * = 每秒數百次 IPC + renderer 數百次渲染。改成 ~24ms 一批,合併同一 (對話,訊息,kind)
     * 的 delta 成一則再送 —— renderer 本來就把 delta 累加進同一氣泡,合併不改變最終結果。
     * key: `${conversationId}::${messageId}::${kind}`。
     */
    private readonly streamBuf = new Map<string, {
        conversationId: string; messageId: string; kind: 'text' | 'thinking'; delta: string
    }>()
    private flushTimer: ReturnType<typeof setTimeout> | null = null
    private static readonly FLUSH_MS = 24

    /** 處理一個 fullStream part → 對應的 IPC push */
    handlePart(raw: unknown, ctx: RunContext): void {
        const p = raw as StreamPart
        const c = IpcChannels
        switch (p.type) {
            case 'text-delta':
                this.bufferDelta(ctx, 'text', p.text ?? '')
                break
            case 'reasoning-delta':
                this.bufferDelta(ctx, 'thinking', p.text ?? '')
                break
            case 'tool-call':
                this.flushStream()  // 工具事件必須排在已累積的文字之後
                this.push(c.AGENT_PUSH_TOOL_USE, {
                    conversationId: ctx.conversationId,
                    messageId: ctx.messageId,
                    toolUseId: p.toolCallId,
                    name: p.toolName,
                    input: p.input
                })
                break
            case 'tool-result':
                this.flushStream()
                this.push(c.AGENT_PUSH_TOOL_RESULT, {
                    conversationId: ctx.conversationId,
                    toolUseId: p.toolCallId,
                    content: p.output,
                    isError: false
                })
                break
            case 'tool-error':
                this.flushStream()
                this.push(c.AGENT_PUSH_TOOL_RESULT, {
                    conversationId: ctx.conversationId,
                    toolUseId: p.toolCallId,
                    content: String(p.error ?? 'tool error'),
                    isError: true
                })
                break
            case 'finish':
                this.flushStream()  // 收尾前把殘留 delta 全部送出
                this.push(c.AGENT_PUSH_END, {
                    conversationId: ctx.conversationId,
                    messageId: ctx.messageId,
                    finishReason: p.finishReason ?? 'stop'
                })
                break
            case 'error':
                this.flushStream()
                logger.warn(`stream error part: ${String(p.error)}`, TAG)
                this.pushError(ctx.conversationId, p.error)
                break
            // text-start/end、reasoning-start/end、start、start-step、finish-step、abort 等不需推
        }
    }

    /** delta 進緩衝,排定一次 flush(已排定就不重排) */
    private bufferDelta(ctx: RunContext, kind: 'text' | 'thinking', text: string): void {
        if (!text) return
        const key = `${ctx.conversationId}::${ctx.messageId}::${kind}`
        const e = this.streamBuf.get(key)
        if (e) e.delta += text
        else this.streamBuf.set(key, {conversationId: ctx.conversationId, messageId: ctx.messageId, kind, delta: text})
        if (this.flushTimer === null) {
            this.flushTimer = setTimeout(() => this.flushStream(), AgentEventBridge.FLUSH_MS)
        }
    }

    /** 把緩衝內所有 delta 各自合併成一則 AGENT_PUSH_STREAM 送出,並清 timer */
    private flushStream(): void {
        if (this.flushTimer !== null) {
            clearTimeout(this.flushTimer)
            this.flushTimer = null
        }
        if (this.streamBuf.size === 0) return
        for (const e of this.streamBuf.values()) {
            this.push(IpcChannels.AGENT_PUSH_STREAM, {
                conversationId: e.conversationId,
                messageId: e.messageId,
                kind: e.kind,
                delta: e.delta,
            })
        }
        this.streamBuf.clear()
    }

    pushError(conversationId: string, err: unknown): void {
        this.flushStream()
        const message = err instanceof Error ? err.message : String(err)
        this.push(IpcChannels.AGENT_PUSH_ERROR, {conversationId, message})
    }

    /** 推權限彈框請求給 renderer(§5;等使用者回 AGENT_PERMISSION_RESPOND) */
    pushPermissionAsk(conversationId: string, payload: {
        approvalId: string
        tool: string
        subject: string
        input: unknown
        suggestedPattern: string
    }): void {
        this.flushStream()
        this.push(IpcChannels.AGENT_PUSH_PERMISSION_ASK, {conversationId, ...payload})
    }

    private push(channel: string, payload: unknown): void {
        // Agent UI 在獨立 agent 視窗,串流推給它(不在主窗)
        const win = this.winMgr.getAgentWindow()
        if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
    }
}
