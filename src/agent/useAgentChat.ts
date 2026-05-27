/**
 * useAgentChat — 核心 while(true) 循環 + openai SDK 流式調用。
 *
 * 對標 Claude Code 的 QueryEngine(設計文件 §2):
 *  1. 上下文壓縮(本期只做 4000 字 / 訊息截斷)
 *  2. 消息規範化(轉成 OpenAI ChatCompletion 格式)
 *  3. System Prompt 注入
 *  4. API 調用(stream: true)
 *  5. 流式解析(text delta 直接 append 到 UI;tool_calls 按 index 累積 JSON 字串)
 *  6. 工具執行路由(renderer 直接執行 / main 走 IPC)
 *  7. 結果注入
 *  8. finish_reason='stop' → 結束;有 tool_calls → 下一輪
 *
 * 流空閒看門狗 90 秒、AbortController 中止、API Key 401 → clearConfig。
 */

import OpenAI from 'openai'
import {useAgentStore, uuid} from './store'
import {executeAgentTool, getToolDefinitions} from './tools'
import type {AgentMessage, OpenAIToolCall} from './types'

const STREAM_IDLE_TIMEOUT_MS = 90_000
const MAX_TOOL_CONTENT_FOR_LLM = 4000

export function useAgentChat() {
    const store = useAgentStore()

    /** 當前流的 AbortController(中止按鈕用) */
    let controller: AbortController | null = null

    /**
     * 主入口:接收使用者輸入,推進 while 循環直到結束。
     *
     * 循環內每輪都會:呼叫 API → 解析流 → 若有 tool_calls 則執行並再次 loop;
     * 否則終止。最多走 store.config.maxTurns 輪。
     */
    async function sendMessage(input: string): Promise<void> {
        if (!input.trim()) return
        if (store.status === 'running') return
        if (!store.isReady) {
            store.errorMessage = '請先在右上角設定填入 API Key'
            store.status = 'error'
            return
        }

        store.status = 'running'
        store.errorMessage = ''
        controller = new AbortController()

        // 1. 把使用者輸入加入訊息列表 + 持久化
        const userMsg: AgentMessage = {
            id: uuid(),
            conversationId: store.conversationId,
            role: 'user',
            content: input,
            timestamp: Date.now(),
        }
        store.addMessage(userMsg)
        void window.agentAPI.saveMessage(userMsg)

        try {
            await runLoop()
            store.status = 'idle'
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            // AbortController.abort() 觸發的是 APIUserAbortError / DOMException
            if (controller?.signal.aborted) {
                store.errorMessage = '已中止'
                store.status = 'idle'
                return
            }
            // 401 / 403 → 清掉 apiKey 提示重新獲取
            if (/401|403|unauthorized|invalid.*api.*key/i.test(msg)) {
                await window.agentAPI.clearConfig()
                store.setConfig({apiKey: ''})
                store.errorMessage = 'API Key 無效或過期,已清除,請重新設定'
            } else {
                store.errorMessage = msg
            }
            store.status = 'error'
        } finally {
            controller = null
        }
    }

    /** 中止當前流 */
    function abort(): void {
        controller?.abort()
    }

    /**
     * while(turn < maxTurns) 循環本體。
     *
     * 每輪都會 push 一條 assistant 消息(streaming=true)到 store,流式 append content,
     * 結束時根據是否有 tool_calls 決定下一步。
     */
    async function runLoop(): Promise<void> {
        const client = new OpenAI({
            apiKey: store.config.apiKey,
            baseURL: store.config.baseUrl,
            // 桌面端是受信任的 first-party 環境,跟設計文件 §9.3 取捨一致
            dangerouslyAllowBrowser: true,
        })

        for (let turn = 0; turn < store.config.maxTurns; turn++) {
            if (controller?.signal.aborted) break

            // ── Step 1-3:組裝 messages(含 system prompt) ────────────────
            const apiMessages = buildApiMessages()

            // ── Step 4:呼叫 API(stream: true) ───────────────────────────
            const stream = await client.chat.completions.create(
                {
                    model: store.config.model,
                    messages: apiMessages,
                    tools: getToolDefinitions(),
                    temperature: store.config.temperature,
                    stream: true,
                },
                {signal: controller?.signal}
            )

            // ── Step 5:流式解析,append 到 UI ─────────────────────────────
            const assistantMsg: AgentMessage = {
                id: uuid(),
                conversationId: store.conversationId,
                role: 'assistant',
                content: '',
                timestamp: Date.now(),
                streaming: true,
            }
            store.addMessage(assistantMsg)

            let contentBuf = ''
            // tool_calls 按 index 累積(SSE delta 可能拆分到多個 chunk)
            const toolCallsAcc = new Map<number, { id: string; name: string; argsBuf: string }>()
            let finishReason: string | null = null

            // 流空閒看門狗:每收到 chunk 重置 timer,timeout 觸發 abort
            let idleTimer: ReturnType<typeof setTimeout> | null = null
            const resetIdleTimer = () => {
                if (idleTimer) clearTimeout(idleTimer)
                idleTimer = setTimeout(() => {
                    controller?.abort()
                }, STREAM_IDLE_TIMEOUT_MS)
            }
            resetIdleTimer()

            try {
                for await (const chunk of stream) {
                    resetIdleTimer()
                    const choice = chunk.choices[0]
                    if (!choice) continue

                    const delta = choice.delta
                    if (delta?.content) {
                        contentBuf += delta.content
                        // 直接 mutate 訊息物件,Vue 響應式可追蹤 — 避免 O(n²) reactivity 重建
                        assistantMsg.content = contentBuf
                    }
                    if (delta?.tool_calls) {
                        for (const tc of delta.tool_calls) {
                            const idx = tc.index ?? 0
                            let acc = toolCallsAcc.get(idx)
                            if (!acc) {
                                acc = {id: tc.id ?? '', name: tc.function?.name ?? '', argsBuf: ''}
                                toolCallsAcc.set(idx, acc)
                            }
                            if (tc.id) acc.id = tc.id
                            if (tc.function?.name) acc.name = tc.function.name
                            if (tc.function?.arguments) acc.argsBuf += tc.function.arguments
                        }
                    }
                    if (choice.finish_reason) finishReason = choice.finish_reason
                }
            } finally {
                if (idleTimer) clearTimeout(idleTimer)
            }

            // ── Step 6:assistant 訊息收尾 ────────────────────────────────
            assistantMsg.streaming = false
            const toolCalls: OpenAIToolCall[] = Array.from(toolCallsAcc.values()).map((acc) => ({
                id: acc.id,
                type: 'function' as const,
                function: {name: acc.name, arguments: acc.argsBuf || '{}'},
            }))
            if (toolCalls.length > 0) {
                assistantMsg.toolCalls = toolCalls
            }
            void window.agentAPI.saveMessage(assistantMsg)

            // ── Step 8:狀態轉換 ─────────────────────────────────────────
            if (!toolCalls.length) {
                // finish_reason='stop' 或無工具調用 → 結束循環
                return
            }

            // ── Step 6-7:工具執行 + 結果注入 ────────────────────────────
            for (const tc of toolCalls) {
                if (controller?.signal.aborted) return
                let parsedArgs: Record<string, unknown> = {}
                try {
                    parsedArgs = JSON.parse(tc.function.arguments || '{}')
                } catch {
                    parsedArgs = {}
                }
                const result = await executeAgentTool(tc.function.name, parsedArgs)
                // 截斷餵給 LLM 的內容(避免 token 爆炸)
                const llmContent = result.ok
                    ? truncate(result.content, MAX_TOOL_CONTENT_FOR_LLM)
                    : `ERROR: ${result.error ?? '未知錯誤'}`
                const toolMsg: AgentMessage = {
                    id: uuid(),
                    conversationId: store.conversationId,
                    role: 'tool',
                    content: llmContent,
                    toolCallId: tc.id,
                    timestamp: Date.now(),
                    toolDisplay: {
                        ok: result.ok,
                        preview: previewFor(tc.function.name, result.ok ? result.content : result.error ?? ''),
                    },
                }
                store.addMessage(toolMsg)
                void window.agentAPI.saveMessage(toolMsg)
            }

            // 循環繼續到下一輪;_finishReason 此時通常為 'tool_calls'
            void finishReason
        }
    }

    /**
     * 把 store.messages 轉成 OpenAI ChatCompletion 期望的 messages 格式。
     * system prompt 永遠在首位。tool 訊息必須帶 tool_call_id。
     */
    function buildApiMessages(): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
        const out: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = []
        const systemPrompt = store.config.systemPrompt?.trim()
        if (systemPrompt) {
            out.push({role: 'system', content: systemPrompt})
        }
        for (const m of store.messages) {
            if (m.role === 'user') {
                out.push({role: 'user', content: m.content ?? ''})
            } else if (m.role === 'assistant') {
                const msg: OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam = {
                    role: 'assistant',
                    content: m.content ?? '',
                }
                if (m.toolCalls?.length) {
                    msg.tool_calls = m.toolCalls.map((tc) => ({
                        id: tc.id,
                        type: 'function',
                        function: {name: tc.function.name, arguments: tc.function.arguments},
                    }))
                }
                out.push(msg)
            } else if (m.role === 'tool') {
                out.push({
                    role: 'tool',
                    content: m.content ?? '',
                    tool_call_id: m.toolCallId ?? '',
                })
            } else if (m.role === 'system') {
                // 一般不會有,store.messages 不存 system;留個防禦
                out.push({role: 'system', content: m.content ?? ''})
            }
        }
        return out
    }

    return {sendMessage, abort}
}

// ── helpers ───────────────────────────────────────────────────────

function truncate(s: string, max: number): string {
    if (s.length <= max) return s
    return s.slice(0, max) + `\n...(截斷,原長度 ${s.length})`
}

/** 工具結果在訊息卡片內展示用的短預覽(完整內容仍餵 LLM) */
function previewFor(name: string, content: string): string {
    if (name === 'screenshot' && content.startsWith('data:image')) {
        return content
    }
    return content.length > 400 ? content.slice(0, 400) + '…' : content
}
