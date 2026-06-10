/**
 * AgentService(現命名沿用,實質為 LLM provider 配置儲存層)。
 *
 * 歷史脈絡:
 *   原本同時管「agent_configs 配置」+「agent_messages 對話歷史」。Agent v1 UI 已移除,
 *   訊息管理移交給未來的 Claude SDK Agent v2(見 docs/19)。本檔現在只負責 KV 配置,
 *   message 相關方法整批拿掉。schema 內 `agent_messages` 表保留(drizzle migration 不
 *   會刪表,v2 上線時直接接手)。
 *
 * 為何不改檔名 / 類名:
 *   ripple 太大(main/index.ts、ipc-handlers/index.ts、type imports...)且無實質好處 —
 *   下個 Agent v2 仍可能複用同一個 service 名。等 v2 真正上線時再統一處理。
 *
 * 寫入容錯:不拋例外;失敗走 logger.error 落庫 + 回傳 false / void。
 */

import {eq} from 'drizzle-orm'
import {logger} from '../../../utils/logger'
import type {DatabaseManager} from '../../database-manager'
import {agentConfigs} from './schema'
import type {LlmConfig, LlmProviderConfig} from '../../../../shared/types/llm.types'

// re-export 讓 caller 不必 deep-link 到 shared types(便於日後再次重整)
export type {LlmConfig, LlmProviderConfig}

/**
 * 持久化的 KV key 列表。
 *
 * v2 範圍只有 `providers` / `activeProviderId` 兩個 — 其餘 agent 特化欄位
 * (systemPrompt / temperature / thinkingEnabled 等)隨 Agent UI 一併移除。
 * Legacy 的 `apiKey` / `baseUrl` / `model` 仍會在 readConfig 內讀一次完成遷移,
 * 寫入時不再持久化(寫到新的 providers[] 結構)。
 */
const CONFIG_KEYS: Array<keyof LlmConfig> = ['providers', 'activeProviderId']

export class AgentService {
    constructor(private readonly dbManager: DatabaseManager) {
    }

    /**
     * 讀取完整配置(缺欄位返回 undefined)。
     *
     * 一次性遷移:若 SQLite 中沒有 `providers` 但有 legacy `apiKey/baseUrl/model`,
     * 自動拼成單一 default provider,並把 activeProviderId 指向它。
     * 不立刻寫回 DB —— 等使用者第一次 writeConfig 時才落地新格式,避免讀路徑有副作用。
     */
    readConfig(): LlmConfig {
        if (!this.dbManager.isReady()) {
            logger.warn('readConfig: dbManager not ready, returning empty', 'AgentService')
            return {}
        }
        const rows = this.dbManager.getDb().select().from(agentConfigs).all()
        const map = new Map(rows.map((r) => [r.key, parseValue(r.value)]))

        const cfg: LlmConfig = {}
        for (const k of CONFIG_KEYS) {
            const v = map.get(k)
            if (v !== undefined && v !== null) (cfg as Record<string, unknown>)[k] = v
        }

        // Diagnostic:debug 路徑顯示 DB 內每 key 的原始值,協助排查「UI 看得到 provider 但 LlmClient 看不到」
        logger.debug(
            `readConfig: rows=${rows.length}, keys=[${Array.from(map.keys()).join(',')}], providers=${
                Array.isArray(cfg.providers) ? cfg.providers.length + ' items' : typeof cfg.providers
            }, active=${cfg.activeProviderId ?? '(none)'}`,
            'AgentService',
        )

        // ── Legacy 一次性遷移 ─────────────────────────────────────────
        // 條件:沒有新格式的 providers,但有舊格式的 apiKey/baseUrl
        const hasProviders = Array.isArray(cfg.providers) && cfg.providers.length > 0
        const legacyApiKey = map.get('apiKey') as string | undefined
        const legacyBaseUrl = map.get('baseUrl') as string | undefined
        const legacyModel = map.get('model') as string | undefined
        if (!hasProviders && (legacyApiKey || legacyBaseUrl)) {
            const migrated: LlmProviderConfig = {
                id: 'legacy-default',
                label: inferProviderLabel(legacyBaseUrl),
                baseUrl: legacyBaseUrl ?? 'https://api.deepseek.com',
                apiKey: legacyApiKey ?? '',
                model: legacyModel,
            }
            cfg.providers = [migrated]
            cfg.activeProviderId = migrated.id
        }

        return cfg
    }

    /** 寫入部分配置。回 true 成功 / false 失敗(DB 未就緒或寫入異常)。 */
    writeConfig(partial: LlmConfig): boolean {
        if (!this.dbManager.isReady()) {
            logger.error('writeConfig 失敗:DB 未就緒', 'AgentService')
            return false
        }
        const db = this.dbManager.getDb()
        const now = Date.now()
        try {
            db.transaction((tx) => {
                for (const k of CONFIG_KEYS) {
                    const v = (partial as Record<string, unknown>)[k]
                    if (v === undefined) continue
                    tx.insert(agentConfigs)
                        .values({key: k, value: JSON.stringify(v), updatedAt: now})
                        .onConflictDoUpdate({
                            target: agentConfigs.key,
                            set: {value: JSON.stringify(v), updatedAt: now},
                        })
                        .run()
                }
            })
            return true
        } catch (err) {
            logger.error('writeConfig 失敗', 'AgentService', err)
            return false
        }
    }

    /**
     * 清空指定 key(預設清掉 legacy 殘留)。
     *
     * 撤銷 active provider 的 apiKey 走 writeConfig 改 providers 陣列,
     * 不該透過這個方法。本方法只給「legacy 遷移後想徹底清掉舊 key」這類維運用。
     */
    clearConfig(keys: string[] = ['apiKey', 'baseUrl', 'model']): void {
        if (!this.dbManager.isReady()) return
        try {
            const db = this.dbManager.getDb()
            db.transaction((tx) => {
                for (const k of keys) {
                    tx.delete(agentConfigs).where(eq(agentConfigs.key, k)).run()
                }
            })
        } catch (err) {
            logger.error('clearConfig 失敗', 'AgentService', err)
        }
    }
}

/**
 * 從舊版 baseUrl 推斷顯示名稱,給遷移後的 provider 用。
 * 命中已知供應商 → 對應中文名;否則 fallback。
 */
function inferProviderLabel(baseUrl: string | undefined): string {
    if (!baseUrl) return 'Default'
    if (baseUrl.includes('deepseek')) return 'DeepSeek'
    if (baseUrl.includes('dashscope') || baseUrl.includes('aliyuncs')) return '通義千問'
    if (baseUrl.includes('openai.com')) return 'OpenAI'
    if (baseUrl.includes('anthropic')) return 'Anthropic'
    return 'Default'
}

function parseValue(s: string): unknown {
    try {
        return JSON.parse(s)
    } catch {
        return s
    }
}
