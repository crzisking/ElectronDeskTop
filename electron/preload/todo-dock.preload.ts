/**
 * 代辦 dock 窗 preload。
 *
 * 暴露:列表 / 計數 / 就地改(patch/complete/setStatus/snooze)+ dockSetInteractive(懸停切穿透)
 * + on/off 訂閱 PUSH_TODO_CHANGED(跨窗即時刷新)。
 * ⚠️ sandbox:true 下 channel 字串內聯;下方 type-only drift 守衛對齊 electron/shared/ipc-channels/todo.ts。
 */

import {contextBridge, ipcRenderer} from 'electron'
import type {TodoChannels} from '../shared/ipc-channels/todo'
import type {TodoPatch, TodoStatus} from '../shared/types/todo.types'

const IPC = {
    TODO_LIST_OPEN: 'todo:list-open',
    TODO_COUNTS: 'todo:counts',
    TODO_GET: 'todo:get',
    TODO_PATCH: 'todo:patch',
    TODO_COMPLETE: 'todo:complete',
    TODO_SET_STATUS: 'todo:set-status',
    TODO_SNOOZE: 'todo:snooze',
    TODO_DOCK_SET_INTERACTIVE: 'todo:dock-set-interactive',
    TODO_OPEN_CAPTURE: 'todo:open-capture',
    PUSH_TODO_CHANGED: 'todo:push:changed',
} as const

// 編譯期 drift 守衛
type SharedChannelValue = (typeof TodoChannels)[keyof typeof TodoChannels]
type _AssertChannelsExist = { [K in keyof typeof IPC]: (typeof IPC)[K] & SharedChannelValue }
const _channelCheck: _AssertChannelsExist = IPC
void _channelCheck

type Result<T> = { ok: true; data: T } | { ok: false; error: string }
const c = <T = unknown>(action: string, args: object = {}) =>
    ipcRenderer.invoke(action, args) as Promise<Result<T>>

const ALLOWED_PUSH: readonly string[] = [IPC.PUSH_TODO_CHANGED]
const listenerMap = new WeakMap<(...a: unknown[]) => void, (e: Electron.IpcRendererEvent, ...a: unknown[]) => void>()

contextBridge.exposeInMainWorld('electronAPI', {
    todo: {
        listOpen: () => c(IPC.TODO_LIST_OPEN),
        counts: () => c(IPC.TODO_COUNTS),
        get: (id: string) => c(IPC.TODO_GET, {id}),
        patch: (id: string, patch: TodoPatch) => c(IPC.TODO_PATCH, {id, patch}),
        complete: (id: string) => c(IPC.TODO_COMPLETE, {id}),
        setStatus: (id: string, status: TodoStatus) => c(IPC.TODO_SET_STATUS, {id, status}),
        snooze: (id: string, dueAt: number) => c(IPC.TODO_SNOOZE, {id, dueAt}),
        dockSetInteractive: (on: boolean) => ipcRenderer.send(IPC.TODO_DOCK_SET_INTERACTIVE, on),
        openCapture: () => c(IPC.TODO_OPEN_CAPTURE),
    },

    on(channel: string, callback: (...args: unknown[]) => void) {
        if (!ALLOWED_PUSH.includes(channel)) return
        const existing = listenerMap.get(callback)
        if (existing) ipcRenderer.off(channel, existing)
        const wrapper = (_e: Electron.IpcRendererEvent, ...args: unknown[]) => callback(...args)
        listenerMap.set(callback, wrapper)
        ipcRenderer.on(channel, wrapper)
    },
    off(channel: string, callback: (...args: unknown[]) => void) {
        const wrapper = listenerMap.get(callback)
        if (wrapper) {
            ipcRenderer.off(channel, wrapper)
            listenerMap.delete(callback)
        }
    },
})
