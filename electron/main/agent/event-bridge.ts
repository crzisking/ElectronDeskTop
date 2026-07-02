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

    /** 處理一個 fullStream part → 對應的 IPC push */
    handlePart(raw: unknown, ctx: RunContext): void {
        const p = raw as StreamPart
        const c = IpcChannels
        switch (p.type) {
            case 'text-delta':
                this.push(c.AGENT_PUSH_STREAM, {
                    conversationId: ctx.conversationId,
                    messageId: ctx.messageId,
                    kind: 'text',
                    delta: p.text ?? ''
                })
                break
            case 'reasoning-delta':
                this.push(c.AGENT_PUSH_STREAM, {
                    conversationId: ctx.conversationId,
                    messageId: ctx.messageId,
                    kind: 'thinking',
                    delta: p.text ?? ''
                })
                break
            case 'tool-call':
                this.push(c.AGENT_PUSH_TOOL_USE, {
                    conversationId: ctx.conversationId,
                    messageId: ctx.messageId,
                    toolUseId: p.toolCallId,
                    name: p.toolName,
                    input: p.input
                })
                break
            case 'tool-result':
                this.push(c.AGENT_PUSH_TOOL_RESULT, {
                    conversationId: ctx.conversationId,
                    toolUseId: p.toolCallId,
                    content: p.output,
                    isError: false
                })
                break
            case 'tool-error':
                this.push(c.AGENT_PUSH_TOOL_RESULT, {
                    conversationId: ctx.conversationId,
                    toolUseId: p.toolCallId,
                    content: String(p.error ?? 'tool error'),
                    isError: true
                })
                break
            case 'finish':
                this.push(c.AGENT_PUSH_END, {
                    conversationId: ctx.conversationId,
                    messageId: ctx.messageId,
                    finishReason: p.finishReason ?? 'stop'
                })
                break
            case 'error':
                logger.warn(`stream error part: ${String(p.error)}`, TAG)
                this.pushError(ctx.conversationId, p.error)
                break
            // text-start/end、reasoning-start/end、start、start-step、finish-step、abort 等不需推
        }
    }

    pushError(conversationId: string, err: unknown): void {
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
        this.push(IpcChannels.AGENT_PUSH_PERMISSION_ASK, {conversationId, ...payload})
    }

    private push(channel: string, payload: unknown): void {
        // Agent UI 在獨立 agent 視窗,串流推給它(不在主窗)
        const win = this.winMgr.getAgentWindow()
        if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
    }
}
