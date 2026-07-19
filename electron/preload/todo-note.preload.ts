/**
 * 代辦備注小窗 preload。
 *
 * 暴露:noteTarget(查編輯目標)/ patch(存備注,復用 TODO_PATCH)/ hideNote(存或 Esc 後隱藏)
 * + on/off 訂閱 note-target-changed(窗已開時換另一條代辦 → 重載回填)。
 * ⚠️ sandbox:true 下 channel 字串內聯;下方 type-only drift 守衛對齊 electron/shared/ipc-channels/todo.ts。
 */

import {contextBridge, ipcRenderer} from 'electron'
import type {TodoChannels} from '../shared/ipc-channels/todo'
import type {TodoPatch} from '../shared/types/todo.types'

const IPC = {
    TODO_NOTE_TARGET: 'todo:note-target',
    TODO_PATCH: 'todo:patch',
    TODO_HIDE_NOTE: 'todo:hide-note',
    TODO_NOTE_TARGET_CHANGED: 'todo:note-target-changed',
} as const

// 編譯期 drift 守衛:每個內聯字串必須存在於 TodoChannels
type SharedChannelValue = (typeof TodoChannels)[keyof typeof TodoChannels]
type _AssertChannelsExist = { [K in keyof typeof IPC]: (typeof IPC)[K] & SharedChannelValue }
const _channelCheck: _AssertChannelsExist = IPC
void _channelCheck

type Result<T> = { ok: true; data: T } | { ok: false; error: string }
const c = <T = unknown>(action: string, args: object = {}) =>
    ipcRenderer.invoke(action, args) as Promise<Result<T>>

const listenerMap = new WeakMap<(...a: unknown[]) => void, (e: Electron.IpcRendererEvent, ...a: unknown[]) => void>()

contextBridge.exposeInMainWorld('electronAPI', {
    todo: {
        noteTarget: () => c(IPC.TODO_NOTE_TARGET),
        patch: (id: string, patch: TodoPatch) => c(IPC.TODO_PATCH, {id, patch}),
        hideNote: () => c(IPC.TODO_HIDE_NOTE),
    },

    on(channel: string, callback: (...args: unknown[]) => void) {
        if (channel !== IPC.TODO_NOTE_TARGET_CHANGED) return
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
