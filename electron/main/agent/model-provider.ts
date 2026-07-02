/**
 * Agent v2 模型入口(docs/19 §4.2)。
 *
 * ⚠️ 模型連線(URL / apiKey / model)**復用現有「模型設定」的 active provider**
 * (AgentService 管的 LlmConfig,work-analysis / daily-advice 也用同一份)——
 * 一個地方配模型,agent 直接取,不自存 URL。仍維持「無預設、沒配好就不可用」的原則:
 * active provider 缺 baseUrl / model → agent 不可用,引導去模型設定。
 */

import {createOpenAICompatible} from '@ai-sdk/openai-compatible'
import type {LanguageModel} from 'ai'
import {logger} from '../utils/logger'
import type {AgentService} from '../db/features/agent/service'

const TAG = 'AgentModelProvider'

/** 解析後的模型連線(來自 active provider) */
export interface LlmConnection {
    baseUrl: string
    model: string
    apiKey: string
}

/** agent 尚未配置(現有模型設定缺 provider / model)時拋出;handler 據此引導去模型設定 */
export class AgentNotConfiguredError extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'AgentNotConfiguredError'
    }
}

/**
 * 從現有模型設定取 active provider 的連線。
 * 取 activeProviderId 對應的 provider;沒指定就取第一個。缺 baseUrl / model → 回 null(不可用)。
 */
export function resolveActiveProvider(agentService: AgentService | null): LlmConnection | null {
    if (!agentService) return null
    const cfg = agentService.readConfig()
    const providers = cfg.providers ?? []
    if (!providers.length) return null
    const active = providers.find((p) => p.id === cfg.activeProviderId) ?? providers[0]
    if (!active.baseUrl || !active.model) return null
    return {baseUrl: active.baseUrl, model: active.model, apiKey: active.apiKey ?? ''}
}

/** active provider 是否已配好(baseUrl + model) */
export function isAgentReady(agentService: AgentService | null): boolean {
    return resolveActiveProvider(agentService) !== null
}

/** 依連線建 AI SDK 的 LanguageModel(缺 URL / model 拋 AgentNotConfiguredError) */
export function buildModel(conn: LlmConnection | null): LanguageModel {
    if (!conn || !conn.baseUrl) throw new AgentNotConfiguredError('尚未配置模型端點,請先到「模型設定」配置 provider 與 URL')
    if (!conn.model) throw new AgentNotConfiguredError('模型設定裡尚未選 model,請先到「模型設定」選擇')
    const provider = createOpenAICompatible({
        name: 'ichia',
        baseURL: conn.baseUrl,
        apiKey: conn.apiKey || undefined,
        includeUsage: true,
    })
    return provider(conn.model)
}

/**
 * 從端點拉可用 model 清單(OpenAI 相容 `GET {baseURL}/models`)。
 * 主要給「模型設定」UI 選 model 用;沒 URL 回空。
 */
export async function listModels(baseUrl: string, apiKey?: string, signal?: AbortSignal): Promise<string[]> {
    if (!baseUrl) return []
    const url = `${baseUrl.replace(/\/$/, '')}/models`
    try {
        const res = await fetch(url, {headers: apiKey ? {Authorization: `Bearer ${apiKey}`} : {}, signal})
        if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
        const json = (await res.json()) as { data?: Array<{ id?: string }> }
        return (json.data ?? [])
            .map((m) => m.id)
            .filter((id): id is string => typeof id === 'string' && id.length > 0)
            .sort()
    } catch (err) {
        logger.warn(`listModels 失敗(${url}):${(err as Error).message}`, TAG)
        throw err
    }
}
