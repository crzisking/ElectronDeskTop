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
import {toRaw} from 'vue'
import {uuid} from '@/shared/utils/uuid'
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
            // 三種失敗:沒有任何 provider / active provider 沒 apiKey / 沒選 model
            const p = store.activeProvider
            if (!p) store.errorMessage = '請先在設定中添加一個 LLM 廠商'
            else if (!p.apiKey) store.errorMessage = `請為「${p.label}」填入 API Key`
            else if (!p.model) store.errorMessage = `請為「${p.label}」選擇一個 model`
            else store.errorMessage = '配置不完整'
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
        // 多 provider 支援:用當前 active provider 的 baseUrl + apiKey 建 client;
        // 若使用者在對話中途切換 provider,下一輪會用新 client(每輪都 new,開銷可忽略)。
        const active = store.activeProvider
        if (!active) throw new Error('沒有可用的 LLM provider')

        const client = new OpenAI({
            apiKey: active.apiKey,
            baseURL: active.baseUrl,
            // 桌面端是受信任的 first-party 環境,跟設計文件 §9.3 取捨一致
            dangerouslyAllowBrowser: true,
        })

        for (let turn = 0; turn < store.config.maxTurns; turn++) {
            if (controller?.signal.aborted) break

            const apiMessages = buildApiMessages()

            // ── Thinking 模式 extra params(DeepSeek V4 / o-series) ─────
            // 開啟條件:store.config.thinkingEnabled === true。
            //   - reasoning_effort 是 OpenAI o-series + DeepSeek 共同接受的標準參數
            //   - thinking.type 是 DeepSeek 透過 extra_body 接收的私有開關;
            //     openai SDK 沒有原生型別支援,直接以 top-level 多餘欄位傳遞 ——
            //     SDK serialize 整個 body 時會帶過去,不認的 provider 會忽略
            //   - 用 `as any` 蓋掉型別檢查;沒原生 typings 是現實
            const thinkingParams: Record<string, unknown> = {}
            if (store.config.thinkingEnabled) {
                thinkingParams.reasoning_effort = store.config.reasoningEffort ?? 'high'
                thinkingParams.thinking = {type: 'enabled'}
            }

            // 為何兩步驟:先建一個有顯式 `stream: true` 的物件讓 SDK 選對 overload(返回 Stream 而非 ChatCompletion),
            // 再用 Object.assign 注入 thinking 額外欄位(它們不在標準型別內)
            const baseParams = {
                model: active.model || '',
                messages: apiMessages,
                tools: getToolDefinitions(),
                temperature: store.config.temperature,
                stream: true as const,
            }
            const stream = await client.chat.completions.create(
                Object.assign(baseParams, thinkingParams),
                {signal: controller?.signal},
            )

            // 本輪 assistant 訊息:先 push 占位,串流解析過程中 mutate content。
            //
            // ⚠️ Vue 3 reactivity 重要陷阱:
            //   - `store.addMessage(draftMsg)` 把 raw 物件塞進 reactive array
            //   - 但 `draftMsg` 變數本身仍是 raw 引用,**對它做 `.content = ...` mutation 不會觸發 reactive trigger**
            //   - 渲染端的 computed / watch 依賴於 proxy set trap 才能感知變化,raw 寫入完全不傳播
            //   - 表現:streaming 文字 / toolCalls / streaming flag 全部停留在初始值,UI 看到空訊息
            //
            // 解法:push 後從 `store.messages[length-1]` 取出 reactive proxy,
            //       後續所有 mutation 走 proxy(包括傳給 consumeStream 的引用),
            //       確保 set trap 被觸發,UI 正確更新。
            const draftMsg: AgentMessage = {
                id: uuid(),
                conversationId: store.conversationId,
                role: 'assistant',
                content: '',
                timestamp: Date.now(),
                streaming: true,
            }
            store.addMessage(draftMsg)
            const assistantMsg = store.messages[store.messages.length - 1]

            // ── stream 解析 ─────────────────────────────────────────
            const {toolCalls} = await consumeStream(stream, assistantMsg, controller)

            // 收尾:標記非 streaming + 落地工具呼叫資訊(走 proxy → 觸發 reactivity)
            assistantMsg.streaming = false
            if (toolCalls.length > 0) {
                assistantMsg.toolCalls = toolCalls
            }
            // ⚠️ 跨 IPC 邊界必須用 toRaw 拆 proxy:
            //   - `ipcRenderer.invoke(channel, payload)` 用 structuredClone 序列化 payload
            //   - reactive proxy 不在 structuredClone 可序列化清單,會同步 throw "An object could not be cloned"
            //   - 同步 throw 在 `void` 表達式內仍會冒泡到外層 try/catch,把整個 runLoop 中斷
            // toRaw 返回 proxy 包裹的原始物件;同一條 assistantMsg 物件的 mutations 都寫到該 raw target,
            // 所以 toRaw 拿到的就是當前最新值,可安全 clone。
            void window.agentAPI.saveMessage(toRaw(assistantMsg))

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
     *
     * Thinking 模式多輪拼接規則(DeepSeek V4 文檔):
     *  - assistant 沒呼叫工具 → 下一輪不回傳 reasoning_content(API 忽略,我們也不浪費 token)
     *  - assistant 呼叫了工具 → 下一輪所有 user 交互輪次**必須**回傳 reasoning_content
     *
     * 算法:從尾往前找,只有「assistant + 帶 toolCalls + 跟最近一個 user 訊息之間」的 reasoning 才回傳。
     * 對非 thinking 模式 / 非 DeepSeek 廠商,reasoning_content 本來就不存在,自然不會回傳。
     */
    function buildApiMessages(): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
        // 預先計算每條 assistant 訊息是否需要帶 reasoning_content
        const includeReasoning = computeReasoningInclusion(store.messages)

        const out: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = []
        const systemPrompt = store.config.systemPrompt?.trim()
        if (systemPrompt) {
            out.push({role: 'system', content: systemPrompt})
        }
        for (let i = 0; i < store.messages.length; i++) {
            const m = store.messages[i]
            if (m.role === 'user') {
                out.push({role: 'user', content: m.content ?? ''})
            } else if (m.role === 'assistant') {
                // openai SDK 型別不認 reasoning_content,但 DeepSeek V4 文檔要求回傳,直接 spread 一個 record 進 body
                const msg: Record<string, unknown> = {
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
                if (includeReasoning[i] && m.reasoningContent) {
                    msg.reasoning_content = m.reasoningContent
                }
                out.push(msg as unknown as OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam)
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
            // 多 provider:只清當前 active provider 的 key,不影響其它廠商
            const active = store.activeProvider
            if (active) {
                store.updateActiveProvider({apiKey: ''})
                // 同步回主進程持久化(toRaw 拆掉 reactive proxy,structuredClone 才能過)
                void window.agentAPI.writeConfig({
                    providers: toRaw(store.config.providers ?? []),
                    activeProviderId: store.config.activeProviderId,
                })
                store.errorMessage = `「${active.label}」的 API Key 無效或過期,已清除,請重新設定`
            } else {
                store.errorMessage = 'API Key 無效或過期'
            }
        } else {
            store.errorMessage = msg
        }
        store.status = 'error'
    }

    return {sendMessage, abort}
}

/**
 * 計算每條 assistant 訊息「在下一輪 API 請求中是否要回傳 reasoning_content」。
 *
 * DeepSeek V4 文檔規則:
 *   "在兩個 user 消息之間,如果模型未進行工具調用,中間 assistant 的 reasoning_content
 *    無需參與上下文拼接;若模型進行了工具調用,則中間 assistant 的 reasoning_content
 *    需參與上下文拼接,在後續所有 user 交互輪次中必須回傳給 API"
 *
 * 算法(O(n)):
 *   把訊息按 user 切段;每一段內若有 assistant 帶 toolCalls → 該段全部 assistant 的 reasoning 都要回傳
 *   段定義:以 user 訊息為段界(user 不歸前段也不歸後段;assistant + tool 訊息屬於最近的後段)
 *
 * 純函式,跟組件解耦,純粹給 buildApiMessages 算 mask 用。
 */
function computeReasoningInclusion(messages: AgentMessage[]): boolean[] {
    const include = new Array(messages.length).fill(false)
    let segmentStart = 0
    let segmentHasToolCall = false

    const flushSegment = (endExclusive: number) => {
        if (!segmentHasToolCall) return
        for (let j = segmentStart; j < endExclusive; j++) {
            if (messages[j].role === 'assistant') include[j] = true
        }
    }

    for (let i = 0; i < messages.length; i++) {
        const m = messages[i]
        if (m.role === 'user') {
            flushSegment(i)
            segmentStart = i + 1
            segmentHasToolCall = false
        } else if (m.role === 'assistant' && m.toolCalls?.length) {
            segmentHasToolCall = true
        }
    }
    // 收尾段(最後一個 user 之後的 assistant + tool):同樣按規則處理
    flushSegment(messages.length)
    return include
}
