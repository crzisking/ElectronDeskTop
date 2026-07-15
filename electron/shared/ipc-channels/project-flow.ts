/**
 * 項目流程 IPC channels(docs/20)。
 *
 * ⚠️ 項目流程的專案/畫布/匯報/反饋/團隊功能已清退(公測前瘦身),只留備忘錄獨立窗
 * 需要的部分:備忘錄 CRUD + AI 備忘建議 + 首頁用的今日活動聚合。
 *
 * 命名:PROJECT_FLOW_* = renderer → main invoke(轉 HTTP 給 tmbom 後端 + cache 加速)
 *       PUSH_PROJECT_FLOW_* = main → renderer push(由 NotificationsHub action 觸發)
 */
export const ProjectFlowChannels = {
    /** 今日 work-collect 聚合(唯讀參考數據,首頁儀表板用) */
    PROJECT_FLOW_TODAY_ACTIVITY: 'pf:today-activity',

    // ── Memos ───────────────────────────────────────────────
    PROJECT_FLOW_LIST_MEMOS: 'pf:list-memos',
    PROJECT_FLOW_CREATE_MEMO: 'pf:create-memo',
    PROJECT_FLOW_UPDATE_MEMO: 'pf:update-memo',
    PROJECT_FLOW_SET_MEMO_STATUS: 'pf:set-memo-status',
    PROJECT_FLOW_DELETE_MEMO: 'pf:delete-memo',

    /** AI 備忘建議 — 本地 LlmClient;輸入是項目節點進度 + 現有待辦,不看原始活動記錄 */
    PROJECT_FLOW_AI_MEMO_SUGGEST: 'pf:ai-memo-suggest',

    /** SignalR push 收到 project-flow.* action 時轉發到 renderer(目前備忘窗未訂閱,保留給未來用) */
    PUSH_PROJECT_FLOW_EVENT: 'push:project-flow-event',
} as const
