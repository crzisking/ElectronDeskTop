/**
 * 代辦錄入小窗 preload。
 *
 * 暴露:create(錄入一句話)/ hideCapture(保存或 Esc 後隱藏)/ triggerVoice(拉 Win+H)
 * + on/off 訂閱 TODO_CAPTURE_SHOWN(窗顯示 → 渲染層先聚焦 input 再拉語音,保證順序)。
 * ⚠️ sandbox:true 下不 import @shared 執行期常數(Rollup 會抽 chunk),channel 字串內聯;
 *    下方 type-only drift 守衛確保跟 electron/shared/ipc-channels/todo.ts 對齊。
 */

import {contextBridge, ipcRenderer} from 'electron'
import type {TodoChannels} from '../shared/ipc-channels/todo'
import type {TodoCreateInput} from '../shared/types/todo.types'

const IPC = {
    TODO_CREATE: 'todo:create',
    TODO_HIDE_CAPTURE: 'todo:hide-capture',
    TODO_TRIGGER_VOICE: 'todo:trigger-voice',
    TODO_CAPTURE_SHOWN: 'todo:capture-shown',
} as const

// 編譯期 drift 守衛:每個內聯字串必須存在於 TodoChannels
type SharedChannelValue = (typeof TodoChannels)[keyof typeof TodoChannels]
type _AssertChannelsExist = { [K in keyof typeof IPC]: (typeof IPC)[K] & SharedChannelValue }
const _channelCheck: _AssertChannelsExist = IPC
void _channelCheck

type Result<T> = { ok: true; data: T } | { ok: false; error: string }
const c = <T = unknown>(action: string, args: object = {}) =>
    ipcRenderer.invoke(action, args) as Promise<Result<T>>

const ALLOWED_PUSH: readonly string[] = [IPC.TODO_CAPTURE_SHOWN]
const listenerMap = new WeakMap<(...a: unknown[]) => void, (e: Electron.IpcRendererEvent, ...a: unknown[]) => void>()

contextBridge.exposeInMainWorld('electronAPI', {
    todo: {
        create: (input: TodoCreateInput) => c(IPC.TODO_CREATE, input),
        hideCapture: () => c(IPC.TODO_HIDE_CAPTURE),
        triggerVoice: () => c(IPC.TODO_TRIGGER_VOICE),
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
