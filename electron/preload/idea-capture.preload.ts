/**
 * 靈感速記速記小窗 preload。
 *
 * 暴露 electronAPI.ideaCapture.* + on/off(只白名單 IDEA_PUSH_*)。
 * ⚠️ sandbox:true 下不 import @shared 執行期常數(Rollup 會抽 chunk),channel 字串內聯;
 *    下方 type-only drift 守衛確保跟 electron/shared/ipc-channels/idea-capture.ts 對齊。
 */

import {contextBridge, ipcRenderer} from 'electron'
import type {IdeaCaptureChannels} from '../shared/ipc-channels/idea-capture'
import type {IdeaCreateMeta, IdeaDraftAttachment, IdeaListQuery, IdeaPatch,} from '../shared/types/idea-capture.types'

const IPC = {
    IDEA_CREATE: 'idea:create',
    IDEA_LIST_MY: 'idea:list-my',
    IDEA_LIST_DEPT: 'idea:list-dept',
    IDEA_DETAIL: 'idea:detail',
    IDEA_PATCH: 'idea:patch',
    IDEA_DELETE: 'idea:delete',
    IDEA_GET_ATTACHMENT: 'idea:get-attachment',
    IDEA_REFINE: 'idea:refine',
    IDEA_GET_CONTEXT: 'idea:get-context',
    IDEA_HIDE_CAPTURE: 'idea:hide-capture',
    IDEA_CONFIG_READ: 'idea:config-read',
    IDEA_CONFIG_WRITE: 'idea:config-write',
    IDEA_PUSH_REFINED: 'idea:push:refined',
} as const

// 編譯期 drift 守衛:每個內聯字串必須存在於 IdeaCaptureChannels
type SharedChannelValue = (typeof IdeaCaptureChannels)[keyof typeof IdeaCaptureChannels]
type _AssertChannelsExist = { [K in keyof typeof IPC]: (typeof IPC)[K] & SharedChannelValue }
const _channelCheck: _AssertChannelsExist = IPC
void _channelCheck

const ALLOWED_PUSH_CHANNELS: readonly string[] = [IPC.IDEA_PUSH_REFINED]

type Result<T> = { ok: true; data: T } | { ok: false; error: string }
const c = <T = unknown>(action: string, args: object = {}) =>
    ipcRenderer.invoke(action, args) as Promise<Result<T>>

const listenerMap = new WeakMap<(...a: unknown[]) => void, (e: Electron.IpcRendererEvent, ...a: unknown[]) => void>()

contextBridge.exposeInMainWorld('electronAPI', {
    ideaCapture: {
        create: (meta: IdeaCreateMeta, files: IdeaDraftAttachment[] = []) => c(IPC.IDEA_CREATE, {meta, files}),
        listMy: (query: IdeaListQuery = {}) => c(IPC.IDEA_LIST_MY, {query}),
        listDept: (query: IdeaListQuery = {}) => c(IPC.IDEA_LIST_DEPT, {query}),
        detail: (clientId: string) => c(IPC.IDEA_DETAIL, {clientId}),
        patch: (clientId: string, patch: IdeaPatch) => c(IPC.IDEA_PATCH, {clientId, patch}),
        remove: (clientId: string) => c(IPC.IDEA_DELETE, {clientId}),
        getAttachment: (url: string) => c<string>(IPC.IDEA_GET_ATTACHMENT, {url}),
        refine: (clientId: string) => c(IPC.IDEA_REFINE, {clientId}),
        getContext: () => c<{ activeWindow: string }>(IPC.IDEA_GET_CONTEXT),
        hideCapture: () => c(IPC.IDEA_HIDE_CAPTURE),
        configRead: () => c(IPC.IDEA_CONFIG_READ),
        configWrite: (partial: object) => c(IPC.IDEA_CONFIG_WRITE, {partial}),
    },

    on(channel: string, callback: (...args: unknown[]) => void) {
        if (!ALLOWED_PUSH_CHANNELS.includes(channel)) return
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
