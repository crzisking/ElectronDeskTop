/**
 * Agent 送出 / 停止 + 串流事件處理。
 *
 * 不自持對話狀態:messages / activeConvId / scrollBottom / reloadConversations 由
 * useAgentConversations 提供(deps 注入),本 composable 只往共享 messages 追加串流內容。
 * delta / tool / end / error 走 electronAPI.on(AGENT_PUSH_*)。
 */
import {onMounted, onUnmounted, ref, type Ref} from 'vue'
import {ElMessage} from 'element-plus'
import {IpcChannels} from '@shared/ipc-channels'
import {agentApi} from '../api'
import type {ChatMsg, ToolMsg, ViewMsg} from '../types'

interface StreamDeps {
    messages: Ref<ViewMsg[]>
    activeConvId: Ref<string>
    ready: Ref<boolean>
    scrollBottom: () => void
    reloadConversations: () => Promise<void>
}

export function useAgentStream(deps: StreamDeps) {
    const input = ref('')
    const sending = ref(false)

    /** 找到 / 預建 assistant 氣泡(串流 delta 會找這個 id 累積) */
    function ensureAssistant(id: string): ChatMsg {
        const found = deps.messages.value.find((m) => m.id === id && m.kind === 'assistant') as ChatMsg | undefined
        if (found) return found
        const msg: ChatMsg = {id, kind: 'assistant', content: '', reasoning: '', streaming: true}
        deps.messages.value.push(msg)
        return msg
    }

    // ── 送出 / 停止 ──
    async function send() {
        const text = input.value.trim()
        if (!text || !deps.ready.value || sending.value) return
        if (!deps.activeConvId.value) {
            ElMessage.info('請先點「新對話」選擇工作資料夾')
            return
        }
        input.value = ''
        sending.value = true
        deps.messages.value.push({id: `u-${Date.now()}`, kind: 'user', content: text})
        deps.scrollBottom()
        try {
            const r = await agentApi.start(deps.activeConvId.value, text)
            deps.activeConvId.value = r.conversationId
            // 預建 assistant 氣泡(串流 delta 會找這個 id 累積)
            ensureAssistant(r.messageId)
            await deps.reloadConversations()
        } catch (err) {
            sending.value = false
            ElMessage.error((err as Error).message)
        }
    }

    function stop() {
        void agentApi.interrupt(deps.activeConvId.value)
        sending.value = false
    }

    // ── 串流事件 ──
    function onStream(...args: unknown[]) {
        const p = args[0] as { conversationId: string; messageId: string; kind: 'text' | 'thinking'; delta: string }
        if (p.conversationId !== deps.activeConvId.value) return
        const m = ensureAssistant(p.messageId)
        if (p.kind === 'thinking') m.reasoning = (m.reasoning ?? '') + p.delta
        else m.content += p.delta
        deps.scrollBottom()
    }

    function onToolUse(...args: unknown[]) {
        const p = args[0] as { conversationId: string; toolUseId: string; name: string; input: unknown }
        if (p.conversationId !== deps.activeConvId.value) return
        deps.messages.value.push({id: p.toolUseId, kind: 'tool', name: p.name, input: p.input, running: true})
        deps.scrollBottom()
    }

    function onToolResult(...args: unknown[]) {
        const p = args[0] as { conversationId: string; toolUseId: string; content: unknown; isError: boolean }
        if (p.conversationId !== deps.activeConvId.value) return
        const t = deps.messages.value.find((m) => m.id === p.toolUseId && m.kind === 'tool') as ToolMsg | undefined
        if (t) {
            t.output = p.content
            t.isError = p.isError
            t.running = false
        }
        deps.scrollBottom()
    }

    function onEnd(...args: unknown[]) {
        const p = args[0] as { conversationId: string; messageId: string }
        if (p.conversationId !== deps.activeConvId.value) return
        const m = deps.messages.value.find((x) => x.id === p.messageId && x.kind === 'assistant') as ChatMsg | undefined
        if (m) m.streaming = false
        sending.value = false
    }

    function onError(...args: unknown[]) {
        const p = args[0] as { conversationId: string; message: string }
        sending.value = false
        ElMessage.error(p.message)
    }

    const C = IpcChannels
    onMounted(() => {
        window.electronAPI.on(C.AGENT_PUSH_STREAM, onStream)
        window.electronAPI.on(C.AGENT_PUSH_TOOL_USE, onToolUse)
        window.electronAPI.on(C.AGENT_PUSH_TOOL_RESULT, onToolResult)
        window.electronAPI.on(C.AGENT_PUSH_END, onEnd)
        window.electronAPI.on(C.AGENT_PUSH_ERROR, onError)
    })

    onUnmounted(() => {
        window.electronAPI.off(C.AGENT_PUSH_STREAM, onStream)
        window.electronAPI.off(C.AGENT_PUSH_TOOL_USE, onToolUse)
        window.electronAPI.off(C.AGENT_PUSH_TOOL_RESULT, onToolResult)
        window.electronAPI.off(C.AGENT_PUSH_END, onEnd)
        window.electronAPI.off(C.AGENT_PUSH_ERROR, onError)
    })

    return {input, sending, send, stop}
}
