/**
 * 桌面代辦 IPC handler(docs/23)—— 薄轉發到本地 TodosService。
 *
 * 統一回 {ok:true,data} | {ok:false,error} envelope(對齊 unwrapIpc)。
 * 任何變更(create/patch/complete/setStatus/snooze)後廣播 PUSH_TODO_CHANGED,
 * 讓 dock 窗 + 主窗即時刷新(跨窗)。payload 淺層,inline 校驗,不引 zod。
 */

import {BrowserWindow, ipcMain} from 'electron'
import {IpcChannels} from '../../shared/ipc-channels'
import {logger} from '../utils/logger'
import type {WindowManager} from '../windows/window-manager'
import type {TodosService} from '../db/features/todos/service'
import type {TodoAiRunner} from '../todo/runner'
import type {TodoPatch, TodoStatus} from '../../shared/types/todo.types'

const TAG = 'IPC:todo'

type Result<T> = { ok: true; data: T } | { ok: false; error: string }

const ok = <T>(data: T): Result<T> => ({ok: true, data})
const fail = (error: string): Result<never> => ({ok: false, error})

const STATUSES: readonly TodoStatus[] = ['inbox', 'active', 'done', 'dropped']

/** 從 payload 取 id(所有單筆操作共用) */
function readId(p: unknown): string | null {
    if (typeof p !== 'object' || p === null) return null
    const id = (p as { id?: unknown }).id
    return typeof id === 'string' && id ? id : null
}

/** 變更後廣播 —— 發給所有窗口(dock / 主窗;未開的自然收不到) */
function broadcastChanged(): void {
    for (const w of BrowserWindow.getAllWindows()) {
        if (!w.isDestroyed()) w.webContents.send(IpcChannels.PUSH_TODO_CHANGED, {})
    }
}

export function registerTodoHandlers(deps: {
    todosService: TodosService | null
    windowManager: WindowManager
    todoAiRunner: TodoAiRunner | null
}): void {
    const svc = () => deps.todosService

    ipcMain.handle(IpcChannels.TODO_HIDE_CAPTURE, () => {
        deps.windowManager.getTodoCaptureWindow().hide()
        return {ok: true, data: true}
    })

    // dock 懸停切穿透(fire-and-forget)
    ipcMain.on(IpcChannels.TODO_DOCK_SET_INTERACTIVE, (_e, on: unknown) => {
        deps.windowManager.getTodoDockWindow().setInteractive(on === true)
    })

    ipcMain.handle(IpcChannels.TODO_OPEN_CAPTURE, () => {
        deps.windowManager.createTodoCaptureWindow()
        return {ok: true, data: true}
    })

    // 🎤 / 錄入窗顯示 → 拉起系統語音輸入(Win+H);拉起即撒手,不代關(語音自己關)
    ipcMain.handle(IpcChannels.TODO_TRIGGER_VOICE, () => {
        deps.windowManager.getTodoCaptureWindow().triggerVoice()
        return {ok: true, data: true}
    })

    // dock 卡片「備注」→ 開可聚焦備注小窗(dock focusable:false 不能打字)
    ipcMain.handle(IpcChannels.TODO_OPEN_NOTE, (_e, p: unknown): Result<boolean> => {
        const id = readId(p)
        if (!id) return fail('缺 id')
        deps.windowManager.createTodoNoteWindow(id)
        return ok(true)
    })

    // 備注窗載入時查編輯目標 → 回 {id, title, note}
    ipcMain.handle(IpcChannels.TODO_NOTE_TARGET, (): Result<unknown> => {
        const s = svc()
        const id = deps.windowManager.getTodoNoteWindow().currentTargetId
        if (!s || !id) return ok(null)
        const row = s.get(id)
        if (!row) return ok(null)
        return ok({id: row.id, title: row.title, note: row.note})
    })

    ipcMain.handle(IpcChannels.TODO_HIDE_NOTE, () => {
        deps.windowManager.getTodoNoteWindow().hide()
        return {ok: true, data: true}
    })

    ipcMain.handle(IpcChannels.TODO_CREATE, (_e, p: unknown): Result<unknown> => {
        const s = svc()
        if (!s) return fail('DB 未就緒')
        const content = (typeof p === 'object' && p !== null) ? (p as { content?: unknown }).content : undefined
        if (typeof content !== 'string' || !content.trim()) return fail('內容不能為空')
        const source = (p as { source?: unknown }).source === 'voice' ? 'voice' : 'keyboard'
        const row = s.create({content, source})
        if (!row) return fail('建立失敗')
        broadcastChanged()
        // 錄入後丟後台 AI 解析(不阻塞;完成後自己廣播刷新)
        deps.todoAiRunner?.enqueue(row.id)
        return ok(row)
    })

    ipcMain.handle(IpcChannels.TODO_LIST_OPEN, (): Result<unknown> => {
        const s = svc()
        return ok(s ? s.listOpen() : [])
    })

    ipcMain.handle(IpcChannels.TODO_COUNTS, (): Result<unknown> => {
        const s = svc()
        return ok(s ? s.counts() : {today: 0, inbox: 0, active: 0})
    })

    ipcMain.handle(IpcChannels.TODO_GET, (_e, p: unknown): Result<unknown> => {
        const s = svc()
        if (!s) return fail('DB 未就緒')
        const id = readId(p)
        if (!id) return fail('缺 id')
        return ok(s.get(id))
    })

    ipcMain.handle(IpcChannels.TODO_PATCH, (_e, p: unknown): Result<unknown> => {
        const s = svc()
        if (!s) return fail('DB 未就緒')
        const id = readId(p)
        if (!id) return fail('缺 id')
        const patch = ((p as { patch?: unknown }).patch ?? {}) as TodoPatch
        const row = s.patch(id, patch)
        broadcastChanged()
        return row ? ok(row) : fail('更新失敗')
    })

    ipcMain.handle(IpcChannels.TODO_COMPLETE, (_e, p: unknown): Result<unknown> => {
        const s = svc()
        if (!s) return fail('DB 未就緒')
        const id = readId(p)
        if (!id) return fail('缺 id')
        const done = s.complete(id)
        broadcastChanged()
        return ok(done)
    })

    ipcMain.handle(IpcChannels.TODO_SET_STATUS, (_e, p: unknown): Result<unknown> => {
        const s = svc()
        if (!s) return fail('DB 未就緒')
        const id = readId(p)
        if (!id) return fail('缺 id')
        const status = (p as { status?: unknown }).status
        if (typeof status !== 'string' || !STATUSES.includes(status as TodoStatus)) return fail('狀態非法')
        const done = s.setStatus(id, status as TodoStatus)
        broadcastChanged()
        return ok(done)
    })

    ipcMain.handle(IpcChannels.TODO_SNOOZE, (_e, p: unknown): Result<unknown> => {
        const s = svc()
        if (!s) return fail('DB 未就緒')
        const id = readId(p)
        if (!id) return fail('缺 id')
        const dueAt = (p as { dueAt?: unknown }).dueAt
        if (typeof dueAt !== 'number') return fail('缺 dueAt')
        const done = s.snooze(id, dueAt)
        broadcastChanged()
        return ok(done)
    })

    logger.info('代辦 IPC handlers 註冊完成', TAG)
}
