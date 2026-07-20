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
import {type AnalyzeResp, toPatch} from './analyze-mapper'

const TAG = 'todo.ai'

/** 桌面本地今天 "yyyy-MM-dd"(傳後端當錨點) */
function localToday(): string {
    const d = new Date()
    const p = (n: number) => (n < 10 ? '0' + n : String(n))
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

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
