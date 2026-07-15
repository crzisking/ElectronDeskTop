/**
 * 備忘錄子視窗 preload。
 *
 * 暴露的能力:
 *   - electronAPI.projectFlow.*:跟主窗同一套 bridge,但所有方法的 ctx 參數可傳空,
 *     主進程 handler 會 fallback 到 main authContext(主窗登入時推進來)
 *   - electronAPI.on/off:訂閱 project-flow.* 推送(SignalR action 轉發)
 *
 * ⚠️ channel 字串內聯不走 @shared/ipc-channels:
 *   sandbox: true 下 Electron 不解析 chunks/;3 個 preload 共用模組會被 Rollup 抽 chunk。
 *   照 log-viewer / floating-ball 同樣處理。
 *
 * **必須跟 electron/shared/ipc-channels/project-flow.ts 對齊**(常數是 'pf:*' 前綴)。
 * 哪裡改了那邊也要動。
 *
 * ⚠️ 項目流程的專案/畫布/匯報/反饋/團隊功能已清退,本檔只留備忘錄窗需要的部分
 * (memo CRUD + AI 備忘建議 + 首頁用的今日活動)。
 */

import {contextBridge, ipcRenderer} from 'electron'
// 型別 import 編譯期擦除,sandbox 下安全;satisfies 檢查在下方擋字串 drift
import type {ProjectFlowChannels} from '../shared/ipc-channels/project-flow'

const IPC = {
    // 對齊 ProjectFlowChannels(electron/shared/ipc-channels/project-flow.ts)
    PF_LIST_MEMOS: 'pf:list-memos',
    PF_CREATE_MEMO: 'pf:create-memo',
    PF_UPDATE_MEMO: 'pf:update-memo',
    PF_SET_MEMO_STATUS: 'pf:set-memo-status',
    PF_DELETE_MEMO: 'pf:delete-memo',
    PF_AI_MEMO_SUGGEST: 'pf:ai-memo-suggest',
    PF_TODAY_ACTIVITY: 'pf:today-activity',

    PUSH_PROJECT_FLOW_EVENT: 'push:project-flow-event',
} as const

/**
 * 編譯期 drift 防護:IPC 的每個 value 必須是 ProjectFlowChannels 裡存在的字串。
 * 任何一邊改了 channel 字串(或共用元件用到本檔漏列的方法),typecheck 直接報錯,
 * 不會等到備忘窗 runtime 才掛。type-only,打包後零成本。
 */
type SharedChannelValue = (typeof ProjectFlowChannels)[keyof typeof ProjectFlowChannels]
type _AssertChannelsExist = { [K in keyof typeof IPC]: (typeof IPC)[K] & SharedChannelValue }
const _channelCheck: _AssertChannelsExist = IPC
void _channelCheck

const ALLOWED_PUSH_CHANNELS: readonly string[] = [IPC.PUSH_PROJECT_FLOW_EVENT]

// 對齊主窗 bridge 的 envelope:{ok:true, data}|{ok:false, error}
type Ok<T> = { ok: true; data: T }
type Err = { ok: false; error: string }
type Result<T> = Ok<T> | Err

/**
 * 不需要 ctx — 主進程 handler 會 fallback 到 main authContext。
 * 仍把 ctx 留作 stub 物件傳遞,符合既有 handler 解析格式。
 */
const c = <T = unknown>(action: string, args: object = {}) =>
    ipcRenderer.invoke(action, {ctx: undefined, ...args}) as Promise<Result<T>>

const listenerMap = new WeakMap<(...a: unknown[]) => void, (e: Electron.IpcRendererEvent, ...a: unknown[]) => void>()

contextBridge.exposeInMainWorld('electronAPI', {
    projectFlow: {
        listMemos: (_ctx: unknown, query: object) => c(IPC.PF_LIST_MEMOS, {query}),
        createMemo: (_ctx: unknown, body: object) => c(IPC.PF_CREATE_MEMO, {body}),
        updateMemo: (_ctx: unknown, memoId: number, body: object) => c(IPC.PF_UPDATE_MEMO, {memoId, body}),
        setMemoStatus: (_ctx: unknown, memoId: number, body: object) => c(IPC.PF_SET_MEMO_STATUS, {memoId, body}),
        deleteMemo: (_ctx: unknown, memoId: number) => c(IPC.PF_DELETE_MEMO, {memoId}),

        aiMemoSuggest: (_ctx: unknown, body: object) => c(IPC.PF_AI_MEMO_SUGGEST, {body}),
        todayActivity: () => c(IPC.PF_TODAY_ACTIVITY, {}),
    },

    /** 訂閱主進程推送(目前只白名單 project-flow 事件) */
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
