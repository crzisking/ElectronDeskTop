/**
 * 首頁「今日活動」api —— 前身 features/project-flow/api(功能退場後只剩這個)。
 * 走 window.electronAPI.activity.*(純本地聚合,不打後端);解 envelope 後回 data。
 */

import {unwrapIpc as unwrap} from '@/shared/utils/ipc'
import type {TodayActivitySummary} from './types'

const act = () => window.electronAPI.activity

export const activityApi = {
    /** 今日 work-collect 摘要(類別 + 24h 熱力;唯讀參考,純本地不打後端) */
    todayActivity: () => unwrap<TodayActivitySummary>(act().todayActivity()),
}
