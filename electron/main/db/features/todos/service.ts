/**
 * TodosService:本地 todos 表的業務 API(docs/23)。
 *
 * P1(無 AI):create 錄入一句話、list 供 dock 顯示、patch 卡片就地改、complete/snooze、counts 給資訊條。
 * 失敗策略對齊 WorkAnalysisService / WorkRecordService:不拋例外,logger.error + 回 null / [] / false。
 */

import {randomUUID} from 'crypto'
import {and, asc, desc, eq, inArray, isNotNull, lt, sql} from 'drizzle-orm'
import {logger} from '../../../utils/logger'
import type {DatabaseManager} from '../../database-manager'
import type {TodoCounts, TodoCreateInput, TodoPatch} from '../../../../shared/types/todo.types'
import {type TodoRow, todos} from './schema'

const TAG = 'TodosService'

/** 本地時區明天 00:00 的 ms —— 「今天該做」= 截止早於此(含逾期) */
function startOfTomorrowLocal(): number {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return d.getTime() + 24 * 60 * 60 * 1000
}

export class TodosService {
    constructor(private readonly dbManager: DatabaseManager) {
    }

    /** 錄入一句話。status 預設 active(P1 無 AI 直接進列表;P2 起走 inbox → AI 整理) */
    create(input: TodoCreateInput): TodoRow | null {
        if (!this.dbManager.isReady()) {
            logger.error('create 失敗:DB 未就緒', TAG)
            return null
        }
        const content = input.content.trim()
        if (!content) return null
        const now = Date.now()
        const row: TodoRow = {
            id: randomUUID(),
            content,
            title: content,
            note: null,
            status: 'active',
            kind: 'task',
            priority: 1,
            category: '',
            owner: null,
            dueAt: null,
            dueKind: 'none',
            source: input.source ?? 'keyboard',
            aiState: 'pending',
            aiHint: null,
            enrichPromptedAt: null,
            createdAt: now,
            updatedAt: now,
            completedAt: null,
        }
        try {
            this.dbManager.getDb().insert(todos).values(row).run()
            return row
        } catch (err) {
            logger.error('create 失敗', TAG, err)
            return null
        }
    }

    /**
     * dock 顯示用:未完成(active + inbox)。
     * 排序:先有截止的按截止升冪,再按優先級降冪,最後新到舊 —— renderer 可再依「現在」細分逾期/今天。
     */
    listOpen(): TodoRow[] {
        if (!this.dbManager.isReady()) return []
        try {
            return this.dbManager.getDb()
                .select()
                .from(todos)
                .where(inArray(todos.status, ['active', 'inbox']))
                .orderBy(asc(todos.dueAt), desc(todos.priority), desc(todos.createdAt))
                .all()
        } catch (err) {
            logger.error('listOpen 失敗', TAG, err)
            return []
        }
    }

    get(id: string): TodoRow | null {
        if (!this.dbManager.isReady()) return null
        try {
            return this.dbManager.getDb().select().from(todos).where(eq(todos.id, id)).get() ?? null
        } catch (err) {
            logger.error('get 失敗', TAG, err)
            return null
        }
    }

    /** 局部更新(卡片就地改)。回更新後的行 */
    patch(id: string, patch: TodoPatch): TodoRow | null {
        if (!this.dbManager.isReady()) return null
        try {
            this.dbManager.getDb()
                .update(todos)
                .set({...patch, updatedAt: Date.now()})
                .where(eq(todos.id, id))
                .run()
            return this.get(id)
        } catch (err) {
            logger.error('patch 失敗', TAG, err)
            return null
        }
    }

    /** 完成 = **真刪除**(不留已完成資料,避免越積越多) */
    complete(id: string): boolean {
        if (!this.dbManager.isReady()) return false
        try {
            this.dbManager.getDb().delete(todos).where(eq(todos.id, id)).run()
            return true
        } catch (err) {
            logger.error('complete(delete) 失敗', TAG, err)
            return false
        }
    }

    setStatus(id: string, status: TodoRow['status']): boolean {
        if (!this.dbManager.isReady()) return false
        try {
            const now = Date.now()
            this.dbManager.getDb()
                .update(todos)
                .set({status, updatedAt: now, completedAt: status === 'done' ? now : null})
                .where(eq(todos.id, id))
                .run()
            return true
        } catch (err) {
            logger.error('setStatus 失敗', TAG, err)
            return false
        }
    }

    /** 延後:設新截止(dueAt),status 保持 active */
    snooze(id: string, dueAt: number): boolean {
        return !!this.patch(id, {dueAt, dueKind: 'none', status: 'active'})
    }

    /** 資訊條計數 */
    counts(): TodoCounts {
        const empty: TodoCounts = {today: 0, inbox: 0, active: 0}
        if (!this.dbManager.isReady()) return empty
        try {
            const db = this.dbManager.getDb()
            const tomorrow = startOfTomorrowLocal()
            const active = db.select({n: sql<number>`count(*)`}).from(todos)
                .where(eq(todos.status, 'active')).get()?.n ?? 0
            const inbox = db.select({n: sql<number>`count(*)`}).from(todos)
                .where(eq(todos.status, 'inbox')).get()?.n ?? 0
            const today = db.select({n: sql<number>`count(*)`}).from(todos)
                .where(and(eq(todos.status, 'active'), isNotNull(todos.dueAt), lt(todos.dueAt, tomorrow)))
                .get()?.n ?? 0
            return {today, inbox, active}
        } catch (err) {
            logger.error('counts 失敗', TAG, err)
            return empty
        }
    }
}
