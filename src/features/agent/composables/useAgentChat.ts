/**
 * useAgentChat — Agent 對話編排核心(§1.7 拆分後的瘦身版)。
 *
 * 對標 Claude Code 的 QueryEngine(設計文件 §2),負責編排:
 *   1. 接收 user input → push user msg → 持久化
 *   2. while(turn < maxTurns) 循環:
 *        a. 建 assistant msg + push 進 store(streaming=true)
 *        b. 呼叫 openai SDK stream → 委派給 useAgentStream.consumeStream 解析
 *        c. 若有 tool_calls → 委派給 useAgentTools.runTools 執行
 *        d. 沒有 tool_calls → finish_reason='stop',結束循環
 *   3. 錯誤分類:abort / 401 / 其它 → 設置 store.status & errorMessage
 *
 * 拆分前本檔 280+ 行,拆分後核心邏輯 ~120 行,
 * stream 解析(useAgentStream)/ 工具執行(useAgentTools)/ 共用 helper(agent-utils)
 * 都搬到同級 composable。
 */

import OpenAI from 'openai'
import {uuid} from '@/utils/uuid'
import {useAgentStore} from '../store'
import {getToolDefinitions} from '../tools'
import type {AgentMessage} from '../types'
import {consumeStream} from './useAgentStream'
import {runTools} from './useAgentTools'

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

        // 把使用者輸入加入訊息列表 + 持久化
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
            handleLoopError(err)
        } finally {
            controller = null
        }
    }

    /** 中止當前流 */
    function abort(): void {
        controller?.abort()
    }

    /**
     * while(turn < maxTurns) 主迴圈。
     *
     * 每輪:建 assistantMsg → consumeStream → 若有 toolCalls 則 runTools → 繼續;
     * 否則 return 結束。
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

            const apiMessages = buildApiMessages()

            const stream = await client.chat.completions.create(
                {
                    model: store.config.model,
                    messages: apiMessages,
                    tools: getToolDefinitions(),
                    temperature: store.config.temperature,
                    stream: true,
                },
                {signal: controller?.signal},
            )

            // 本輪 assistant 訊息:先 push 占位,串流解析過程中 mutate content
            const assistantMsg: AgentMessage = {
                id: uuid(),
                conversationId: store.conversationId,
                role: 'assistant',
                content: '',
                timestamp: Date.now(),
                streaming: true,
            }
            store.addMessage(assistantMsg)

            // ── stream 解析 ─────────────────────────────────────────
            const {toolCalls} = await consumeStream(stream, assistantMsg, controller)

            // 收尾:標記非 streaming + 落地工具呼叫資訊
            assistantMsg.streaming = false
            if (toolCalls.length > 0) {
                assistantMsg.toolCalls = toolCalls
            }
            void window.agentAPI.saveMessage(assistantMsg)

            // 沒有 tool_calls → 對話自然結束,跳出循環
            if (!toolCalls.length) return

            // ── 工具執行 + 結果注入 ────────────────────────────────
            const aborted = await runTools({
                toolCalls,
                conversationId: store.conversationId,
                controller,
                addMessage: store.addMessage,
            })
            if (aborted) return
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

    /**
     * 統一錯誤分類:
     *  - AbortController.abort() 觸發 → 顯示「已中止」,status 回 idle
     *  - 401 / 403 / unauthorized → 清掉 apiKey,要求重新設定
     *  - 其它 → 直接展示錯誤訊息
     */
    function handleLoopError(err: unknown): void {
        const msg = err instanceof Error ? err.message : String(err)
        if (controller?.signal.aborted) {
            store.errorMessage = '已中止'
            store.status = 'idle'
            return
        }
        if (/401|403|unauthorized|invalid.*api.*key/i.test(msg)) {
            void window.agentAPI.clearConfig()
            store.setConfig({apiKey: ''})
            store.errorMessage = 'API Key 無效或過期,已清除,請重新設定'
        } else {
            store.errorMessage = msg
        }
        store.status = 'error'
    }

    return {sendMessage, abort}
}
