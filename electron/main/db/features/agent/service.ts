/**
 * AgentService:agent_configs / agent_messages 表的業務 API。
 *
 * 為 Agent 獨立窗口提供:
 *  - 配置讀寫(KV 表,值統一 JSON.stringify)
 *  - 對話歷史 CRUD(分頁查詢、保存、按 conversationId 清空)
 *
 * 寫入容錯:不拋例外;失敗走 logger.error 落庫 + 回傳 false 讓 caller 感知。
 * (不像 LogService 用 console.error —— 那是日誌服務本身,用 logger 會遞迴。)
 */

import {asc, eq, sql} from 'drizzle-orm'
// sql 在 listConversations 內仍會用到 — drop ensureTables 後 import 保留
import {logger} from '../../../utils/logger'
import type {DatabaseManager} from '../../database-manager'
import {agentConfigs, type AgentMessageRow, agentMessages} from './schema'
import type {AgentConfig, AgentMessage, OpenAIToolCall, ProviderConfig,} from '../../../../shared/types/agent.types'

// re-export 讓既有 import path 不變(handler 端 import from '../db/features/agent/service' 不用動)
export type {AgentConfig, AgentMessage}

/**
 * 新版會持久化的 KV key 列表。
 *
 * `providers` / `activeProviderId` 是多 provider 切換的核心(對應 doc 18 後續擴充);
 * legacy 的 `apiKey` / `baseUrl` / `model` **不再寫入**,但 readConfig 仍會讀取它們以
 * 完成單 → 多 provider 的一次性遷移。
 */
const CONFIG_KEYS: Array<keyof AgentConfig> = [
    'providers',
    'activeProviderId',
    'systemPrompt',
    'temperature',
    'maxTurns',
    // Thinking mode(DeepSeek V4 等)
    'thinkingEnabled',
    'reasoningEffort',
]

export class AgentService {
    constructor(private readonly dbManager: DatabaseManager) {
    }

    /**
     * 讀取完整配置(缺欄位返回 undefined)。
     *
     * 一次性遷移:若 SQLite 中沒有 `providers` 但有 legacy `apiKey/baseUrl/model`,
     * 自動拼成單一 default provider(label = 「Default」),並把 activeProviderId 指向它。
     * 不立刻寫回 DB —— 等使用者第一次 writeConfig 時才落地新格式,避免讀路徑有副作用。
     */
    readConfig(): AgentConfig {
        if (!this.dbManager.isReady()) return {}
        const rows = this.dbManager.getDb().select().from(agentConfigs).all()
        const map = new Map(rows.map((r) => [r.key, parseValue(r.value)]))

        const cfg: AgentConfig = {}
        for (const k of CONFIG_KEYS) {
            const v = map.get(k)
            if (v !== undefined && v !== null) (cfg as Record<string, unknown>)[k] = v
        }

        // ── Legacy 一次性遷移 ─────────────────────────────────────────
        // 條件:沒有新格式的 providers,但有舊格式的 apiKey/baseUrl
        const hasProviders = Array.isArray(cfg.providers) && cfg.providers.length > 0
        const legacyApiKey = map.get('apiKey') as string | undefined
        const legacyBaseUrl = map.get('baseUrl') as string | undefined
        const legacyModel = map.get('model') as string | undefined
        if (!hasProviders && (legacyApiKey || legacyBaseUrl)) {
            const migrated: ProviderConfig = {
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
    writeConfig(partial: AgentConfig): boolean {
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
     * 清空指定鍵。
     *
     * 401 / 403 時的處理:不再 wipe 整個 `apiKey`(老語意,單 provider 時代),
     * 而是把當前 active provider 的 apiKey 設成空字串。本層只保留通用 deleteByKey,
     * 具體「清掉哪個 provider 的 key」由渲染端決定,呼叫 writeConfig 覆寫 providers。
     *
     * 兼容老呼叫:預設清掉 legacy `apiKey` key(若殘留)。
     */
    clearConfig(keys: Array<string> = ['apiKey']): void {
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

    /** 列出某對話的消息(按時間升序) */
    listMessages(conversationId: string, limit = 200): AgentMessage[] {
        if (!this.dbManager.isReady()) return []
        const rows = this.dbManager
            .getDb()
            .select()
            .from(agentMessages)
            .where(eq(agentMessages.conversationId, conversationId))
            .orderBy(asc(agentMessages.timestamp))
            .limit(limit)
            .all()
        return rows.map(rowToMessage)
    }

    /**
     * 列出所有對話 — 給左側對話列表用。
     *
     * 同一 conversationId 內取首條 user 消息當標題(截斷 40 字);
     * lastTime 取該對話最後一條消息時間,用於排序與顯示「最近活動」。
     * SQL 一次撈完聚合,避免 N+1。
     */
    listConversations(limit = 100): Array<{
        conversationId: string;
        title: string;
        lastTime: number;
        messageCount: number
    }> {
        if (!this.dbManager.isReady()) return []
        // 用原生 SQL 一次聚合:對每個 conversationId 取首條 user 消息作標題,以及最後時間
        const rows = this.dbManager.getDb().all(
            sql`
                SELECT m.conversationId AS conversationId,
                       (SELECT content
                        FROM agent_messages
                        WHERE conversationId = m.conversationId
                          AND role = 'user'
                        ORDER BY timestamp ASC LIMIT 1
                    ) AS title, MAX (m.timestamp) AS lastTime, COUNT (*) AS messageCount
                FROM agent_messages m
                GROUP BY m.conversationId
                ORDER BY lastTime DESC
                    LIMIT ${limit}
            `
        ) as Array<{ conversationId: string; title: string | null; lastTime: number; messageCount: number }>
        return rows.map((r) => ({
            conversationId: r.conversationId,
            title: deriveTitle(r.title),
            lastTime: r.lastTime,
            messageCount: r.messageCount,
        }))
    }

    saveMessage(msg: AgentMessage): void {
        if (!this.dbManager.isReady()) return
        try {
            this.dbManager
                .getDb()
                .insert(agentMessages)
                .values({
                    id: msg.id,
                    conversationId: msg.conversationId,
                    role: msg.role,
                    content: msg.content ?? null,
                    reasoningContent: msg.reasoningContent ?? null,
                    toolCalls: msg.toolCalls ? JSON.stringify(msg.toolCalls) : null,
                    toolCallId: msg.toolCallId ?? null,
                    timestamp: msg.timestamp,
                })
                .run()
        } catch (err) {
            logger.error('saveMessage 失敗', 'AgentService', err)
        }
    }

    clearMessages(conversationId?: string): void {
        if (!this.dbManager.isReady()) return
        try {
            const db = this.dbManager.getDb()
            if (conversationId) {
                db.delete(agentMessages).where(eq(agentMessages.conversationId, conversationId)).run()
            } else {
                db.delete(agentMessages).run()
            }
        } catch (err) {
            logger.error('clearMessages 失敗', 'AgentService', err)
        }
    }
}

/**
 * 從舊版 baseUrl 推斷一個有意義的顯示名稱,給遷移後的 provider 用。
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

function deriveTitle(raw: string | null): string {
    if (!raw) return '新對話'
    // 取首行 + 截斷 40 字
    const firstLine = raw.split('\n')[0].trim()
    if (!firstLine) return '新對話'
    return firstLine.length > 40 ? firstLine.slice(0, 40) + '…' : firstLine
}

function rowToMessage(r: AgentMessageRow): AgentMessage {
    return {
        id: r.id,
        conversationId: r.conversationId,
        role: r.role as AgentMessage['role'],
        content: r.content,
        reasoningContent: r.reasoningContent ?? undefined,
        // DB 存的是 stringified JSON,parse 回來 cast 成 OpenAIToolCall[](信任寫入端正確序列化)
        toolCalls: r.toolCalls ? (safeParse(r.toolCalls) as OpenAIToolCall[] | undefined) : undefined,
        toolCallId: r.toolCallId ?? undefined,
        timestamp: r.timestamp,
    }
}

function safeParse(s: string): unknown {
    try {
        return JSON.parse(s)
    } catch {
        return null
    }
}

function parseValue(s: string): unknown {
    try {
        return JSON.parse(s)
    } catch {
        return s
    }
}
