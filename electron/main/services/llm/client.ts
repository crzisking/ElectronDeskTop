/**
 * LlmClient — 主進程內共用的 LLM 呼叫層。
 *
 * 設計目標:
 *   把 openai SDK + agent_configs 內的 provider 配置包成簡單 API,
 *   讓任何 main process 內想呼 LLM 的功能(工作分析、未來各種 AI 助手等)
 *   不必各自重複處理「讀 active provider / 組 client / 處理錯誤」這串。
 *
 * 為何放 main 不放 renderer:
 *   API key 不該出 main 進程(同 saved_credentials / Claude SDK 的安全邊界)。
 *   renderer 透過 IPC 呼叫某個 feature handler,handler 再用本 client 打 LLM,
 *   key 全程留在 main。
 *
 * 為何沿用 openai SDK 而非自寫 HTTP:
 *   DeepSeek / 通義 / OpenAI 都對外提供 OpenAI 兼容端點,SDK 直接走;
 *   要加 streaming / function calling 等進階功能也是現成。
 *
 * 不做的事(明確邊界):
 *   - 不負責「工具循環」/「subagent」/「permission」— 那些是 Agent v2(Claude SDK)的事
 *   - 不做 stream(預留介面,真有需要再加)
 *   - 不快取 client instance(provider 配置會變,跨呼叫重建成本可忽略)
 */

import OpenAI from 'openai'
import {logger} from '../../utils/logger'
import type {AgentService} from '../../db/features/agent/service'
import type {LlmProviderConfig} from '../../../shared/types/llm.types'

const TAG = 'LlmClient'

/** 配置層錯誤:provider 沒設好、key 缺失等,使用者層面問題 */
export class LlmConfigError extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'LlmConfigError'
    }
}

/** 呼叫層錯誤:HTTP 失敗、超時、回應格式異常等 */
export class LlmCallError extends Error {
    constructor(message: string, readonly cause?: unknown) {
        super(message)
        this.name = 'LlmCallError'
    }
}

/** chat.completions 訊息結構(對齊 OpenAI),呼叫端自己組 */
export interface LlmMessage {
    role: 'system' | 'user' | 'assistant'
    content: string
}

/** 完成請求的 options(complete + stream 共用) */
export interface LlmCompleteOptions {
    messages: LlmMessage[]
    /** 指定 providerId(預設用 active provider) */
    providerId?: string
    /** 覆寫 provider.model;呼叫端想用同一 provider 跑不同 model 走這個 */
    model?: string
    /** 0-2,預設不傳(用 server side default) */
    temperature?: number
    /** 強制 JSON 回應(provider 須支援 response_format: json_object) */
    responseFormat?: 'text' | 'json_object'
    /** 取消用 */
    signal?: AbortSignal
    /** HTTP timeout,預設 60s */
    timeoutMs?: number
}

/** stream chunk 事件 — caller 透過 for-await 消費 */
export type LlmStreamEvent =
    | { kind: 'delta'; text: string }
    | {
    kind: 'done'
    finalText: string
    model: string
    providerId: string
    providerLabel: string
    inputTokens?: number
    outputTokens?: number
}

/** complete 的結果 */
export interface LlmCompleteResult {
    /** 完整回應文字(從 choices[0].message.content) */
    content: string
    /** 實際使用的 model(provider 預設 vs 呼叫覆寫的最終結果) */
    model: string
    /** 用的 provider id / label,給日誌跟報告用 */
    providerId: string
    providerLabel: string
    /** 用量(provider 回了才有;未回為 undefined) */
    inputTokens?: number
    outputTokens?: number
}

/**
 * LlmClient — 由 main/index.ts 在啟動時建立一個實例,注入需要呼叫 LLM 的 feature。
 * 本身無狀態,每次 complete() 都重新組 OpenAI client(避免快取過期配置)。
 */
export class LlmClient {
    constructor(private readonly agentService: AgentService) {
    }

    /**
     * 取要用的 provider(預設 active,可由 providerId 覆寫)。
     * 拋 LlmConfigError 讓呼叫端用 try/catch 區分「配置問題」vs「呼叫失敗」。
     */
    resolveProvider(providerId?: string): LlmProviderConfig {
        const cfg = this.agentService.readConfig()
        const providers = cfg.providers ?? []
        if (providers.length === 0) {
            throw new LlmConfigError('尚未配置任何 LLM provider')
        }

        const targetId = providerId ?? cfg.activeProviderId
        if (!targetId) {
            throw new LlmConfigError('未指定 providerId 且無 active provider')
        }

        const provider = providers.find((p) => p.id === targetId)
        if (!provider) {
            throw new LlmConfigError(`找不到 provider id=${targetId}`)
        }
        if (!provider.apiKey) {
            throw new LlmConfigError(`provider "${provider.label}" 缺 apiKey`)
        }
        if (!provider.baseUrl) {
            throw new LlmConfigError(`provider "${provider.label}" 缺 baseUrl`)
        }

        return provider
    }

    /**
     * 測試連線 — 設置頁「測試」按鈕用。
     *
     * 行為:對指定 provider 發一個極短的 dummy completion("ping" → 回 "pong" 之類),
     * 確認 baseUrl / apiKey / model 三者組合可走通。
     *
     * 為什麼用 complete 而非另寫 ping:
     *   不同 provider 沒有統一的 health check endpoint;`/v1/models` 也不是所有
     *   provider 都實作。發一個 1-token 上限的 completion 是最普適的「我能說話嗎」。
     *
     * 為什麼 max_tokens 設 4 而非 1:
     *   有些 provider 對 max_tokens=1 會回空 content(剛好被 stop token 截斷),
     *   反而誤判失敗。設 4 留一點生存空間。
     */
    async testConnection(providerId?: string): Promise<{
        ok: true
        model: string
        providerLabel: string
        latencyMs: number
    } | {
        ok: false
        error: string
        kind: 'config' | 'call'
    }> {
        try {
            const startedAt = Date.now()
            const result = await this.complete({
                messages: [{role: 'user', content: 'ping'}],
                providerId,
                temperature: 0,
            })
            return {
                ok: true,
                model: result.model,
                providerLabel: result.providerLabel,
                latencyMs: Date.now() - startedAt,
            }
        } catch (err) {
            if (err instanceof LlmConfigError) return {ok: false, error: err.message, kind: 'config'}
            if (err instanceof LlmCallError) return {ok: false, error: err.message, kind: 'call'}
            return {ok: false, error: String(err), kind: 'call'}
        }
    }

    /**
     * 一次性 chat completion(非串流)。
     *
     * 失敗會包成 LlmConfigError(配置問題)或 LlmCallError(呼叫問題),
     * 不再透傳 openai SDK 原始 Error,讓呼叫端錯誤處理統一。
     */
    async complete(opts: LlmCompleteOptions): Promise<LlmCompleteResult> {
        const provider = this.resolveProvider(opts.providerId)
        const model = opts.model ?? provider.model
        if (!model) {
            throw new LlmConfigError(`provider "${provider.label}" 未指定 model`)
        }

        const client = new OpenAI({
            apiKey: provider.apiKey,
            baseURL: provider.baseUrl,
            timeout: opts.timeoutMs ?? 60_000,
        })

        try {
            const resp = await client.chat.completions.create(
                {
                    model,
                    messages: opts.messages,
                    temperature: opts.temperature,
                    response_format:
                        opts.responseFormat === 'json_object'
                            ? {type: 'json_object'}
                            : undefined,
                },
                {signal: opts.signal},
            )

            const content = resp.choices?.[0]?.message?.content ?? ''
            if (!content) {
                throw new LlmCallError('LLM 回應 content 為空')
            }

            return {
                content,
                model: resp.model ?? model,
                providerId: provider.id,
                providerLabel: provider.label,
                inputTokens: resp.usage?.prompt_tokens,
                outputTokens: resp.usage?.completion_tokens,
            }
        } catch (err) {
            if (err instanceof LlmCallError) throw err
            const message = err instanceof Error ? err.message : String(err)
            logger.warn(`LLM 呼叫失敗 provider=${provider.label} model=${model}: ${message}`, TAG)
            throw new LlmCallError(message, err)
        }
    }

    /**
     * 串流 completion — 用 OpenAI SDK 的 streaming,每個 chunk 走 `delta`,
     * 最後一個 chunk 推 `done`(帶總文字 + token 用量)。
     *
     * 使用方式:
     * ```ts
     *   for await (const event of llm.stream({ messages, ... })) {
     *     if (event.kind === 'delta') push(event.text)
     *     else if (event.kind === 'done') save(event.finalText)
     *   }
     * ```
     *
     * caller 用 AbortController.abort() 中止;SDK 會丟出 AbortError,本函式抓住後正常結束 generator,
     * 不會 yield 任何 done(caller 自己判斷「中途中止 vs 正常結束」)。
     */
    async* stream(opts: LlmCompleteOptions): AsyncIterable<LlmStreamEvent> {
        const provider = this.resolveProvider(opts.providerId)
        const model = opts.model ?? provider.model
        if (!model) {
            throw new LlmConfigError(`provider "${provider.label}" 未指定 model`)
        }

        const client = new OpenAI({
            apiKey: provider.apiKey,
            baseURL: provider.baseUrl,
            timeout: opts.timeoutMs ?? 120_000,  // streaming 比一次性允許更長
        })

        let streamObj: Awaited<ReturnType<typeof client.chat.completions.create>> | null = null
        try {
            streamObj = await client.chat.completions.create(
                {
                    model,
                    messages: opts.messages,
                    temperature: opts.temperature,
                    response_format:
                        opts.responseFormat === 'json_object'
                            ? {type: 'json_object'}
                            : undefined,
                    stream: true,
                    stream_options: {include_usage: true},  // 末尾 chunk 帶 usage
                },
                {signal: opts.signal},
            )
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            logger.warn(`LLM stream 啟動失敗 provider=${provider.label}: ${message}`, TAG)
            throw new LlmCallError(message, err)
        }

        let finalText = ''
        let actualModel = model
        let inputTokens: number | undefined
        let outputTokens: number | undefined

        try {
            // OpenAI SDK 的 streaming response 是 AsyncIterable<ChatCompletionChunk>
            for await (const chunk of streamObj as AsyncIterable<{
                model?: string
                choices?: Array<{ delta?: { content?: string | null } }>
                usage?: { prompt_tokens?: number; completion_tokens?: number }
            }>) {
                if (opts.signal?.aborted) return  // 中止:不再 yield done

                if (chunk.model) actualModel = chunk.model

                const delta = chunk.choices?.[0]?.delta?.content
                if (delta) {
                    finalText += delta
                    yield {kind: 'delta', text: delta}
                }

                if (chunk.usage) {
                    inputTokens = chunk.usage.prompt_tokens
                    outputTokens = chunk.usage.completion_tokens
                }
            }
        } catch (err) {
            // AbortError 不算錯,正常 stream 中止;其他錯包成 LlmCallError
            const isAbort = (err as { name?: string })?.name === 'AbortError'
                || opts.signal?.aborted === true
            if (isAbort) return
            const message = err instanceof Error ? err.message : String(err)
            logger.warn(`LLM stream 中途失敗 provider=${provider.label}: ${message}`, TAG)
            throw new LlmCallError(message, err)
        }

        yield {
            kind: 'done',
            finalText,
            model: actualModel,
            providerId: provider.id,
            providerLabel: provider.label,
            inputTokens,
            outputTokens,
        }
    }
}
