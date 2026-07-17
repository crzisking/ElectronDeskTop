/**
 * 桌面代辦表(todos)—— 本地 SQLite 儲存(docs/23)。
 *
 * 由「備忘錄」概念演進而來,但**儲存改為本地**(秒開 / 離線可用 / 單工作機);
 * 不走後端即時 CRUD。欄位型別的字串聯集收斂自 @shared/types/todo.types。
 *
 * 配套設計:[docs/23-桌面代辦設計.md](../../../../../docs/23-桌面代辦設計.md)
 */

import {index, integer, sqliteTable, text} from 'drizzle-orm/sqlite-core'
import type {
    TodoAiState,
    TodoCategory,
    TodoDueKind,
    TodoKind,
    TodoSource,
    TodoStatus,
} from '../../../../shared/types/todo.types'

export const todos = sqliteTable(
    'todos',
    {
        /** 主鍵:randomUUID(service 生成),便於跨窗去重 / 未來同步 */
        id: text('id').primaryKey(),

        /** 那句原話,永遠保留 */
        content: text('content').notNull(),
        /** 顯示標題,缺省 = content(AI 可提煉) */
        title: text('title').notNull(),
        /** 備注(漸進補充) */
        note: text('note'),

        status: text('status').$type<TodoStatus>().notNull().default('active'),
        kind: text('kind').$type<TodoKind>().notNull().default('task'),
        /** 0 低 / 1 中 / 2 高 */
        priority: integer('priority').notNull().default(1),
        category: text('category').$type<TodoCategory>().notNull().default(''),
        owner: text('owner'),

        /** 絕對截止 unix ms(可空) */
        dueAt: integer('dueAt'),
        dueKind: text('dueKind').$type<TodoDueKind>().notNull().default('none'),

        source: text('source').$type<TodoSource>().notNull().default('keyboard'),
        /** 後台 AI 分析狀態(列預設無所謂:create() 一律顯式寫 'pending';改預設會觸發 SQLite 重建表) */
        aiState: text('aiState').$type<TodoAiState>().notNull().default('skipped'),
        /** AI 給的一句提示(docs/23 P2) */
        aiHint: text('aiHint'),
        /** 漸進式完善節流 ms */
        enrichPromptedAt: integer('enrichPromptedAt'),

        createdAt: integer('createdAt').notNull(),
        updatedAt: integer('updatedAt').notNull(),
        completedAt: integer('completedAt'),
    },
    (t) => ({
        statusIdx: index('todos_status_idx').on(t.status),
        dueIdx: index('todos_due_idx').on(t.dueAt),
    }),
)

export type TodoRow = typeof todos.$inferSelect
export type NewTodo = typeof todos.$inferInsert
