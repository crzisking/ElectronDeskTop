/**
 * 每日學習建議 IPC handler — 薄轉發層,業務全在 DailyAdviceScheduler。
 *
 * scheduler 為 null(DB / LLM 基建沒起來)時回友善錯誤,不讓首頁白屏。
 */

import {ipcMain} from 'electron'
import {IpcChannels} from '../../shared/ipc-channels'
import type {DailyAdviceScheduler} from '../services/daily-advice/scheduler'

export function registerDailyAdviceHandlers(scheduler: DailyAdviceScheduler | null): void {
    ipcMain.handle(IpcChannels.DAILY_ADVICE_STATUS, () => {
        if (!scheduler) return {ok: false, error: '服務未就緒'}
        return {ok: true, data: scheduler.getStatus()}
    })

    ipcMain.handle(IpcChannels.DAILY_ADVICE_GENERATE, async () => {
        if (!scheduler) return {ok: false, error: '服務未就緒'}
        try {
            return {ok: true, data: await scheduler.generateNow()}
        } catch (err) {
            return {ok: false, error: (err as Error).message}
        }
    })
}
