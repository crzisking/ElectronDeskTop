/**
 * AgentService:agent_configs / agent_messages 表的業務 API。
 *
 * 為 Agent 獨立窗口提供:
 *  - 配置讀寫(KV 表,值統一 JSON.stringify)
 *  - 對話歷史 CRUD(分頁查詢、保存、按 conversationId 清空)
 *
 * 寫入容錯比照 LogService:失敗只 console.error,不擴散到 caller。
 */

import {asc, eq, sql} from 'drizzle-orm'
// sql 在 listConversations 內仍會用到 — drop ensureTables 後 import 保留
import type {DatabaseManager} from '../../database-manager'
import {agentConfigs, type AgentMessageRow, agentMessages} from './schema'
import type {AgentConfig, AgentMessage, OpenAIToolCall} from '../../../../shared/types/agent.types'

// re-export 讓既有 import path 不變(handler 端 import from '../db/features/agent/service' 不用動)
export type {AgentConfig, AgentMessage}

const CONFIG_KEYS: Array<keyof AgentConfig> = [
    'apiKey',
    'baseUrl',
    'model',
    'systemPrompt',
    'temperature',
    'maxTurns',
]

export class AgentService {
    constructor(private readonly dbManager: DatabaseManager) {
    }

    /** 讀取完整配置(缺欄位返回 undefined) */
    readConfig(): AgentConfig {
        if (!this.dbManager.isReady()) return {}
        const rows = this.dbManager.getDb().select().from(agentConfigs).all()
        const map = new Map(rows.map((r) => [r.key, parseValue(r.value)]))
        const cfg: AgentConfig = {}
        for (const k of CONFIG_KEYS) {
            const v = map.get(k)
            if (v !== undefined && v !== null) (cfg as Record<string, unknown>)[k] = v
        }
        return cfg
    }

    /** 寫入部分配置 */
    writeConfig(partial: AgentConfig): void {
        if (!this.dbManager.isReady()) return
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
        } catch (err) {
            console.error('[AgentService] writeConfig 失敗', err)
        }
    }

    /** 清空指定鍵(用於 401 時清掉 apiKey 觸發重新獲取) */
    clearConfig(keys: Array<keyof AgentConfig> = ['apiKey']): void {
        if (!this.dbManager.isReady()) return
        try {
            const db = this.dbManager.getDb()
            db.transaction((tx) => {
                for (const k of keys) {
                    tx.delete(agentConfigs).where(eq(agentConfigs.key, k)).run()
                }
            })
        } catch (err) {
            console.error('[AgentService] clearConfig 失敗', err)
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
                    toolCalls: msg.toolCalls ? JSON.stringify(msg.toolCalls) : null,
                    toolCallId: msg.toolCallId ?? null,
                    timestamp: msg.timestamp,
                })
                .run()
        } catch (err) {
            console.error('[AgentService] saveMessage 失敗', err)
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
            console.error('[AgentService] clearMessages 失敗', err)
        }
    }

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
