/**
 * electronAPI.projectFlow 子介面 — 對齊 preload/bridges/project-flow.bridge.ts。
 *
 * ⚠️ 專案/畫布/匯報/反饋/團隊/備忘錄功能已全數清退(公測前瘦身;備忘錄由桌面代辦本地
 * 取代)。只剩首頁儀表板用的 todayActivity。
 */

import type {IpcResult as Result} from '@shared/types/ipc.types'

export interface ProjectFlowAPI {
    /** 今日 work-collect 聚合(首頁儀表板用) */
    todayActivity: () => Promise<Result<unknown>>
}
