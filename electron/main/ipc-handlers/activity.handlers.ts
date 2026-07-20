/**
 * 今日活動 IPC handler —— 純通道註冊層。
 *
 * 前身 project-flow.handlers(功能退場後只剩「今日活動」):純本地讀 work-collect 聚合,不打後端。
 */

import {ipcMain} from 'electron'
import {IpcChannels} from '../../shared/ipc-channels'
import {summarizeTodayActivityFromService} from '../services/activity/today-activity'
import {safeRun} from '../utils/ipc-result'
import type {WorkRecordService} from '../db/features/work-collect/service'

interface ActivityHandlerDeps {
    workRecordService: WorkRecordService | null
}

export function registerActivityHandlers(deps: ActivityHandlerDeps = {workRecordService: null}): void {
    ipcMain.handle(IpcChannels.ACTIVITY_TODAY, async () =>
        safeRun(async () => {
            if (!deps.workRecordService) throw new Error('工作採集服務未就緒')
            return summarizeTodayActivityFromService(deps.workRecordService)
        }))
}
