/**
 * electronAPI.activity 子介面 —— 對齊 preload/bridges/activity.bridge.ts。
 * 前身 ProjectFlowAPI(功能退場後只剩首頁今日活動聚合)。
 */

import type {IpcResult as Result} from '@shared/types/ipc.types'

export interface ActivityAPI {
    /** 今日 work-collect 聚合(首頁儀表板用) */
    todayActivity: () => Promise<Result<unknown>>
}
