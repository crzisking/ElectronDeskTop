/**
 * 項目流程 IPC channels。
 *
 * ⚠️ 項目流程的專案/畫布/匯報/反饋/團隊/備忘錄功能已全數清退(公測前瘦身;備忘錄由
 * 桌面代辦本地取代,見 docs/23)。本模組只剩首頁儀表板用的「今日活動」聚合(純本地讀
 * work-collect,不打後端)。
 */
export const ProjectFlowChannels = {
    /** 今日 work-collect 聚合(唯讀參考數據,首頁儀表板用) */
    PROJECT_FLOW_TODAY_ACTIVITY: 'pf:today-activity',
} as const
