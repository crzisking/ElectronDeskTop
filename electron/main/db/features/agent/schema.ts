/**
 * Agent 功能 schema:agent_configs(KV) + agent_messages(對話歷史)。
 *
 * 設計動機:
 *  - apiKey / baseUrl / model 等屬於 Agent 自身的配置,跟主 config 七張表解耦,
 *    避免影響既有 ConfigManager / resync 行為
 *  - 對話歷史是 Agent 專屬資料,獨立一張表方便清空 / 查詢
 */

import {index, integer, sqliteTable, text} from 'drizzle-orm/sqlite-core'

/** Agent 配置 KV 表(api_key / base_url / model / system_prompt / temperature / max_turns) */
export const agentConfigs = sqliteTable('agent_configs', {
    key: text('key').primaryKey(),
    value: text('value').notNull(),
    updatedAt: integer('updatedAt').notNull(),
})

/** Agent 對話消息表 */
export const agentMessages = sqliteTable(
    'agent_messages',
    {
        id: text('id').primaryKey(),
        /** 同一對話的消息共享 conversationId */
        conversationId: text('conversationId').notNull(),
        /** 'user' / 'assistant' / 'tool' / 'system' */
        role: text('role').notNull(),
        /** 消息文本(可空,純工具調用時 content 為空) */
        content: text('content'),
        /** LLM 工具調用請求(JSON stringified) */
        toolCalls: text('toolCalls'),
        /** tool role 消息對應的 tool_call_id */
        toolCallId: text('toolCallId'),
        /** Unix ms */
        timestamp: integer('timestamp').notNull(),
    },
    (table) => ({
        idxConv: index('idx_agent_messages_conv').on(table.conversationId, table.timestamp),
    })
)

export type AgentConfigRow = typeof agentConfigs.$inferSelect
export type AgentMessageRow = typeof agentMessages.$inferSelect
export type NewAgentMessage = typeof agentMessages.$inferInsert
