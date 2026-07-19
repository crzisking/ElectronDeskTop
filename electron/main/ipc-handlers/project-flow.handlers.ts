/**
 * 項目流程 IPC handler — 純通道註冊層。
 *
 * ⚠️ 專案/畫布/匯報/反饋/團隊/備忘錄功能已全數清退(公測前瘦身;備忘錄由桌面代辦本地
 * 取代,見 docs/23)。只剩首頁儀表板用的「今日活動」:純本地讀 work-collect 聚合,
 * 不打後端。
 */

import {ipcMain} from 'electron'
import {IpcChannels} from '../../shared/ipc-channels'
import {summarizeTodayActivityFromService} from '../services/project-flow/ai-local'
import {safeRun} from '../utils/ipc-result'
import type {WorkRecordService} from '../db/features/work-collect/service'

/** 註冊 handler 時注入的相依 */
interface ProjectFlowHandlerDeps {
    workRecordService: WorkRecordService | null
}

export function registerProjectFlowHandlers(
    deps: ProjectFlowHandlerDeps = {workRecordService: null},
): void {
    // 今日活動摘要 — 純本地讀 work-collect,不打後端(首頁儀表板用)
    ipcMain.handle(IpcChannels.PROJECT_FLOW_TODAY_ACTIVITY, async () =>
        safeRun(async () => {
            if (!deps.workRecordService) throw new Error('工作採集服務未就緒')
            return summarizeTodayActivityFromService(deps.workRecordService)
        }))
}
