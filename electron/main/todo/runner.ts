/**
 * 代辦 AI runner(docs/23 P2)—— 後台佇列:錄入後調後端 /api/todo/analyze 解析,
 * 把相對時間換算成絕對 dueAt,patch 本地 todo,廣播刷新。
 *
 * 對齊靈感速記 refiner:單 worker、不阻塞錄入;沒配 / 失敗 → 標 skipped/failed,手動完全可用。
 * AI 走後端(TMBOM),桌面只調端點 + 存本地(見 docs/23 §6)。
 */

import {BrowserWindow} from 'electron'
import {IpcChannels} from '../../shared/ipc-channels'
import {logger} from '../utils/logger'
import {authContext} from '../services/auth-context'
import {sendMain} from '../services/http/main-http'
import type {TodosService} from '../db/features/todos/service'
import type {TodoDueKind, TodoKind, TodoPatch, TodoPriority} from '../../shared/types/todo.types'

const TAG = 'todo.ai'

interface AnalyzeResp {
    kind?: string
    title?: string
    priority?: number
    /** 絕對截止日 "yyyy-MM-dd" 或 null(後端依 today 錨點算好) */
    dueDate?: string | null
    time?: string | null
    category?: string
    owner?: string
    hint?: string
}

/** 桌面本地今天 "yyyy-MM-dd"(傳後端當錨點) */
function localToday(): string {
    const d = new Date()
    const p = (n: number) => (n < 10 ? '0' + n : String(n))
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

const KINDS = new Set(['task', 'bug', 'meeting', 'reminder'])

export class TodoAiRunner {
    private queue: string[] = []
    private running = false

    constructor(private readonly todos: TodosService) {
    }

    /** 排入分析佇列(去重) */
    enqueue(id: string): void {
        if (!this.queue.includes(id)) this.queue.push(id)
        void this.pump()
    }

    /** 啟動時把既有 pending 一次補跑 */
    enqueuePending(): void {
        for (const t of this.todos.listOpen()) {
            if (t.aiState === 'pending') this.enqueue(t.id)
        }
    }

    private async pump(): Promise<void> {
        if (this.running) return
        this.running = true
        try {
            while (this.queue.length) {
                const id = this.queue.shift()!
                await this.analyzeOne(id)
            }
        } finally {
            this.running = false
        }
    }

    private async analyzeOne(id: string): Promise<void> {
        const todo = this.todos.get(id)
        if (!todo || todo.aiState !== 'pending') return

        const {baseUrl, token} = authContext.get()
        if (!baseUrl) {
            this.todos.patch(id, {aiState: 'skipped'})
            this.broadcast()
            return
        }

        try {
            const res = await sendMain<AnalyzeResp>(
                {baseUrl, token},
                'POST',
                '/api/todo/analyze',
                {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({content: todo.content, today: localToday()}),
                },
                30_000,
                TAG,
            )
            this.todos.patch(id, toPatch(res))
        } catch (err) {
            logger.warn(`analyze 失敗 ${id}: ${(err as Error).message}`, TAG)
            this.todos.patch(id, {aiState: 'failed'})
        }
        this.broadcast()
    }

    private broadcast(): void {
        for (const w of BrowserWindow.getAllWindows()) {
            if (!w.isDestroyed()) w.webContents.send(IpcChannels.PUSH_TODO_CHANGED, {})
        }
    }
}

/** AnalyzeResp → 本地 patch(欄位校驗 + 時間換算) */
function toPatch(res: AnalyzeResp): TodoPatch {
    const {dueAt, dueKind} = resolveDate(res.dueDate, res.time)
    const kind = (res.kind && KINDS.has(res.kind) ? res.kind : 'task') as TodoKind
    const priority = (res.priority === 0 || res.priority === 2 ? res.priority : 1) as TodoPriority
    const category = res.category === 'work' || res.category === 'life' ? res.category : ''

    const patch: TodoPatch = {
        kind,
        priority,
        category,
        owner: res.owner?.trim() || null,
        dueAt,
        dueKind,
        aiHint: res.hint?.trim() || null,
        aiState: 'done',
    }
    const title = res.title?.trim()
    if (title) patch.title = title
    return patch
}

/** 後端給的絕對日期 "yyyy-MM-dd" + 時刻 → 截止 ms;無日期 → null。日期由 AI 依 today 錨點算好,這裡只組時刻。 */
function resolveDate(dueDate: string | null | undefined, time: string | null | undefined):
    { dueAt: number | null; dueKind: TodoDueKind } {
    const m = dueDate ? /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(dueDate.trim()) : null
    if (!m) return {dueAt: null, dueKind: 'none'}

    const now = new Date()
    const day = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
    const isToday = day.toDateString() === now.toDateString()
    const hm = time && /^\d{1,2}:\d{2}$/.test(time) ? time.split(':') : null
    day.setHours(hm ? Number(hm[0]) : (isToday ? 18 : 9), hm ? Number(hm[1]) : 0, 0, 0)

    const endOfWeek = new Date(now)
    endOfWeek.setHours(23, 59, 59, 999)
    endOfWeek.setDate(now.getDate() + (7 - now.getDay()))
    const dueKind: TodoDueKind = isToday ? 'today' : (day.getTime() <= endOfWeek.getTime() ? 'thisweek' : 'none')

    return {dueAt: day.getTime(), dueKind}
}
