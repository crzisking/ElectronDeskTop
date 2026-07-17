/**
 * project-flow renderer ↔ main 的 API 包裝層。
 *
 * ⚠️ 專案/畫布/匯報/反饋/團隊/備忘錄功能已全數清退(公測前瘦身;備忘錄由桌面代辦本地
 * 取代)。只剩首頁儀表板用的 todayActivity(純本地聚合,不打後端)。
 *
 * 透過 window.electronAPI.projectFlow.* 走 IPC;每個 method 解 envelope:
 * {ok:true, data} 直接回 data,{ok:false, error} 拋例外。
 */

import {unwrapIpc as unwrap} from '@/shared/utils/ipc'
import type {TodayActivitySummary} from './types'

const pf = () => window.electronAPI.projectFlow

export const projectFlowApi = {
    /** 今日 work-collect 摘要(類別 + 24h 熱力;唯讀參考,純本地不打後端) */
    todayActivity: () => unwrap<TodayActivitySummary>(pf().todayActivity()),
}
