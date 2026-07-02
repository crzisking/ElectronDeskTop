/**
 * Agent v2 對話持久化(docs/19 §7.1 / §7.3)。
 *
 * 讀寫既有的 `agent_messages` 表(schema 現成,v1 移除時保留)。負責:
 *  - resume:把某對話歷史讀回組成 messages 灌給 agent
 *  - 落庫:agent 跑完把新訊息寫回
 *  - 列對話 / 刪對話 / fork(從某條訊息分支出新對話,對齊 opencode session fork)
 */

import {randomUUID} from 'crypto'
import {and, asc, desc, eq, lt} from 'drizzle-orm'
import {logger} from '../utils/logger'
import type {DatabaseManager} from '../db/database-manager'
import {type AgentMessageRow, agentMessages, type NewAgentMessage} from '../db/features/agent/schema'
import type {AgentMessage, AgentToolCall, ConversationSummary} from '../../shared/types/agent.types'

const TAG = 'AgentDbAdapter'

export class AgentDbAdapter {
    constructor(private readonly dbManager: DatabaseManager) {
    }

    private get db() {
        return this.dbManager.getDb()
    }

    /**
     * 某對話的訊息,按時間升序。
     *  - 不給 limit:回全部(resume 灌歷史給 LLM 用)
     *  - 給 limit:回「最近 limit 則」(懶加載;beforeTimestamp 給定時,取該時間點之前的一頁)
     */
    listMessages(conversationId: string, limit?: number, beforeTimestamp?: number): AgentMessage[] {
        if (!this.dbManager.isReady()) return []
        const conds = [eq(agentMessages.conversationId, conversationId)]
        if (beforeTimestamp !== undefined) conds.push(lt(agentMessages.timestamp, beforeTimestamp))
        const where = conds.length > 1 ? and(...conds) : conds[0]

        if (limit && limit > 0) {
            // 取最近 limit 則(DESC + limit),再反轉成升序給 UI
            const rows = this.db.select().from(agentMessages).where(where)
                .orderBy(desc(agentMessages.timestamp)).limit(limit).all()
            return rows.reverse().map(rowToMessage)
        }
        return this.db.select().from(agentMessages).where(where)
            .orderBy(asc(agentMessages.timestamp)).all()
            .map(rowToMessage)
    }

    /** 追加一則訊息 */
    append(msg: AgentMessage): void {
        if (!this.dbManager.isReady()) return
        try {
            this.db.insert(agentMessages).values(messageToRow(msg)).run()
        } catch (err) {
            logger.error('append 失敗', TAG, err)
        }
    }

    /** 列所有對話(標題 = 首條 user 訊息截斷;按最後活動時間降序) */
    listConversations(): ConversationSummary[] {
        if (!this.dbManager.isReady()) return []
        const rows = this.db.select().from(agentMessages).orderBy(asc(agentMessages.timestamp)).all()
        const byConv = new Map<string, { title: string; updatedAt: number; count: number }>()
        for (const r of rows) {
            const entry = byConv.get(r.conversationId) ?? {title: '', updatedAt: 0, count: 0}
            entry.count++
            entry.updatedAt = Math.max(entry.updatedAt, r.timestamp)
            if (!entry.title && r.role === 'user' && r.content) entry.title = r.content.slice(0, 40)
            byConv.set(r.conversationId, entry)
        }
        return [...byConv.entries()]
            .map(([conversationId, e]) => ({
                conversationId,
                title: e.title || '(未命名對話)',
                updatedAt: e.updatedAt,
                messageCount: e.count
            }))
            .sort((a, b) => b.updatedAt - a.updatedAt)
    }

    /** 刪整個對話 */
    deleteConversation(conversationId: string): void {
        if (!this.dbManager.isReady()) return
        try {
            this.db.delete(agentMessages).where(eq(agentMessages.conversationId, conversationId)).run()
        } catch (err) {
            logger.error('deleteConversation 失敗', TAG, err)
        }
    }

    /**
     * 從某對話 fork:複製到 uptoMessageId(含)為止的訊息成新對話。回新 conversationId。
     * 對齊 opencode 的 session fork(從某條訊息岔新分支)。
     */
    fork(conversationId: string, uptoMessageId: string): string {
        const all = this.listMessages(conversationId)
        const cut = all.findIndex((m) => m.id === uptoMessageId)
        const slice = cut >= 0 ? all.slice(0, cut + 1) : all
        const newId = randomUUID()
        if (!this.dbManager.isReady()) return newId
        try {
            this.db.transaction((tx) => {
                for (const m of slice) {
                    tx.insert(agentMessages).values(messageToRow({...m, id: randomUUID(), conversationId: newId})).run()
                }
            })
        } catch (err) {
            logger.error('fork 失敗', TAG, err)
        }
        return newId
    }
}

function rowToMessage(r: AgentMessageRow): AgentMessage {
    return {
        id: r.id,
        conversationId: r.conversationId,
        role: r.role as AgentMessage['role'],
        content: r.content ?? '',
        reasoningContent: r.reasoningContent ?? undefined,
        toolCalls: r.toolCalls ? (safeParse(r.toolCalls) as AgentToolCall[]) : undefined,
        toolCallId: r.toolCallId ?? undefined,
        timestamp: r.timestamp,
    }
}

function messageToRow(m: AgentMessage): NewAgentMessage {
    return {
        id: m.id,
        conversationId: m.conversationId,
        role: m.role,
        content: m.content || null,
        reasoningContent: m.reasoningContent ?? null,
        toolCalls: m.toolCalls ? JSON.stringify(m.toolCalls) : null,
        toolCallId: m.toolCallId ?? null,
        timestamp: m.timestamp,
    }
}

function safeParse(s: string): unknown {
    try {
        return JSON.parse(s)
    } catch {
        return undefined
    }
}
