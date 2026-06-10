/**
 * 每日學習建議 bridge — 首頁的兩個 invoke。
 * PUSH_DAILY_ADVICE 走主 preload 的 electronAPI.on()(白名單已加),本檔只暴露 invoke。
 */

import type {IpcRenderer} from 'electron'

export interface DailyAdviceChannelMap {
    DAILY_ADVICE_STATUS: string
    DAILY_ADVICE_GENERATE: string
}

export function createDailyAdviceBridge(ipc: IpcRenderer, ch: DailyAdviceChannelMap) {
    return {
        /** 首頁初始載入:前置狀態 + 今日建議 + 歷史 */
        status: () => ipc.invoke(ch.DAILY_ADVICE_STATUS),
        /** 手動立即生成(覆蓋今日) */
        generate: () => ipc.invoke(ch.DAILY_ADVICE_GENERATE),
    }
}
