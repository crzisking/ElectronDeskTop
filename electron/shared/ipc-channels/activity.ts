/**
 * 今日活動聚合 IPC channel。
 *
 * 前身是 project-flow（已全數退場,見 docs/23);只剩首頁儀表板用的「今日活動」——
 * 純本地讀 work-collect 聚合,不打後端。
 */
export const ActivityChannels = {
    /** 今日 work-collect 聚合(唯讀參考數據,首頁熱力圖用) */
    ACTIVITY_TODAY: 'activity:today',
} as const
