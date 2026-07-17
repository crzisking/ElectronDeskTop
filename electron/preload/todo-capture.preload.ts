/**
 * 代辦錄入小窗 preload。
 *
 * 只暴露錄入窗需要的:create(錄入一句話)/ hideCapture(保存或 Esc 後隱藏)。
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
} as const

// 編譯期 drift 守衛:每個內聯字串必須存在於 TodoChannels
type SharedChannelValue = (typeof TodoChannels)[keyof typeof TodoChannels]
type _AssertChannelsExist = { [K in keyof typeof IPC]: (typeof IPC)[K] & SharedChannelValue }
const _channelCheck: _AssertChannelsExist = IPC
void _channelCheck

type Result<T> = { ok: true; data: T } | { ok: false; error: string }
const c = <T = unknown>(action: string, args: object = {}) =>
    ipcRenderer.invoke(action, args) as Promise<Result<T>>

contextBridge.exposeInMainWorld('electronAPI', {
    todo: {
        create: (input: TodoCreateInput) => c(IPC.TODO_CREATE, input),
        hideCapture: () => c(IPC.TODO_HIDE_CAPTURE),
        triggerVoice: () => c(IPC.TODO_TRIGGER_VOICE),
    },
})
