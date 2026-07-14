/**
 * 靈感速記速記小窗 preload。
 *
 * 只暴露速記小窗需要的:create / get-context / hide-capture / config。
 * (想法庫的讀寫已改渲染端直連後端;完善走主進程佇列,都不在這個獨立窗。)
 * ⚠️ sandbox:true 下不 import @shared 執行期常數(Rollup 會抽 chunk),channel 字串內聯;
 *    下方 type-only drift 守衛確保跟 electron/shared/ipc-channels/idea-capture.ts 對齊。
 */

import {contextBridge, ipcRenderer} from 'electron'
import type {IdeaCaptureChannels} from '../shared/ipc-channels/idea-capture'
import type {IdeaCreateMeta, IdeaDraftAttachment} from '../shared/types/idea-capture.types'

const IPC = {
    IDEA_CREATE: 'idea:create',
    IDEA_GET_CONTEXT: 'idea:get-context',
    IDEA_HIDE_CAPTURE: 'idea:hide-capture',
    IDEA_CONFIG_READ: 'idea:config-read',
    IDEA_CONFIG_WRITE: 'idea:config-write',
} as const

// 編譯期 drift 守衛:每個內聯字串必須存在於 IdeaCaptureChannels
type SharedChannelValue = (typeof IdeaCaptureChannels)[keyof typeof IdeaCaptureChannels]
type _AssertChannelsExist = { [K in keyof typeof IPC]: (typeof IPC)[K] & SharedChannelValue }
const _channelCheck: _AssertChannelsExist = IPC
void _channelCheck

type Result<T> = { ok: true; data: T } | { ok: false; error: string }
const c = <T = unknown>(action: string, args: object = {}) =>
    ipcRenderer.invoke(action, args) as Promise<Result<T>>

contextBridge.exposeInMainWorld('electronAPI', {
    ideaCapture: {
        create: (meta: IdeaCreateMeta, files: IdeaDraftAttachment[] = []) => c(IPC.IDEA_CREATE, {meta, files}),
        getContext: () => c<{ activeWindow: string }>(IPC.IDEA_GET_CONTEXT),
        hideCapture: () => c(IPC.IDEA_HIDE_CAPTURE),
        configRead: () => c(IPC.IDEA_CONFIG_READ),
        configWrite: (partial: object) => c(IPC.IDEA_CONFIG_WRITE, {partial}),
    },
})
