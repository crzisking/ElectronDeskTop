/**
 * 項目流程圖 IPC channels(docs/20)。
 * 命名:PROJECT_FLOW_* = renderer → main invoke(轉 HTTP 給 tmbom 後端 + cache 加速)
 *       PUSH_PROJECT_FLOW_* = main → renderer push(由 NotificationsHub action 觸發)
 */
export const ProjectFlowChannels = {
    // ── Projects / Nodes / Edges ────────────────────────────
    PROJECT_FLOW_LIST_PROJECTS: 'pf:list-projects',
    PROJECT_FLOW_GET_PROJECT: 'pf:get-project',
    PROJECT_FLOW_CREATE_PROJECT: 'pf:create-project',
    PROJECT_FLOW_UPDATE_PROJECT: 'pf:update-project',
    PROJECT_FLOW_DELETE_PROJECT: 'pf:delete-project',

    PROJECT_FLOW_CREATE_NODE: 'pf:create-node',
    PROJECT_FLOW_UPDATE_NODE: 'pf:update-node',
    PROJECT_FLOW_DELETE_NODE: 'pf:delete-node',
    PROJECT_FLOW_PATCH_NODE_STATUS: 'pf:patch-node-status',
    PROJECT_FLOW_GET_NODE_PROGRESS: 'pf:get-node-progress',
    PROJECT_FLOW_LIST_NODE_REPORT_ITEMS: 'pf:list-node-report-items',

    PROJECT_FLOW_CREATE_EDGE: 'pf:create-edge',
    PROJECT_FLOW_UPDATE_EDGE: 'pf:update-edge',
    PROJECT_FLOW_DELETE_EDGE: 'pf:delete-edge',

    /** 跨項目「我的節點」(個人時間線 / 備忘 AI 進度輸入) */
    PROJECT_FLOW_MY_NODES: 'pf:my-nodes',
    /** 員工模糊搜尋(複用後端 /api/employee/getEmployees;負責人選擇彈窗用) */
    PROJECT_FLOW_SEARCH_EMPLOYEES: 'pf:search-employees',
    /** 今日 work-collect 聚合(唯讀參考數據,給匯報編輯器顯示) */
    PROJECT_FLOW_TODAY_ACTIVITY: 'pf:today-activity',

    // ── Reports ─────────────────────────────────────────────
    PROJECT_FLOW_LIST_REPORTS: 'pf:list-reports',
    PROJECT_FLOW_GET_REPORT: 'pf:get-report',
    PROJECT_FLOW_CREATE_REPORT: 'pf:create-report',
    PROJECT_FLOW_UPDATE_REPORT: 'pf:update-report',
    PROJECT_FLOW_SUBMIT_REPORT: 'pf:submit-report',
    PROJECT_FLOW_DELETE_REPORT: 'pf:delete-report',

    /** AI 寫作建議 — 本地 LlmClient;看草稿+今日數據給思路/潤色/遺漏,不代寫 */
    PROJECT_FLOW_AI_REPORT_ADVICE: 'pf:ai-report-advice',
    /** AI 備忘建議 — 本地 LlmClient;輸入是項目節點進度 + 現有待辦,不看原始活動記錄 */
    PROJECT_FLOW_AI_MEMO_SUGGEST: 'pf:ai-memo-suggest',

    // ── Memos ───────────────────────────────────────────────
    PROJECT_FLOW_LIST_MEMOS: 'pf:list-memos',
    PROJECT_FLOW_CREATE_MEMO: 'pf:create-memo',
    PROJECT_FLOW_UPDATE_MEMO: 'pf:update-memo',
    PROJECT_FLOW_SET_MEMO_STATUS: 'pf:set-memo-status',
    PROJECT_FLOW_DELETE_MEMO: 'pf:delete-memo',

    // ── Feedback ────────────────────────────────────────────
    PROJECT_FLOW_CREATE_FEEDBACK: 'pf:create-feedback',
    PROJECT_FLOW_LIST_FEEDBACK_BY_TARGET: 'pf:list-feedback-by-target',
    PROJECT_FLOW_LIST_MY_UNREAD: 'pf:list-my-unread',
    PROJECT_FLOW_COUNT_MY_UNREAD: 'pf:count-my-unread',
    PROJECT_FLOW_MARK_FEEDBACK_READ: 'pf:mark-feedback-read',

    // ── Team ────────────────────────────────────────────────
    PROJECT_FLOW_LIST_SUBORDINATES: 'pf:list-subordinates',
    PROJECT_FLOW_LIST_SUB_REPORTS: 'pf:list-sub-reports',
    PROJECT_FLOW_LIST_SUB_MEMOS: 'pf:list-sub-memos',

    // ── AI server-side ──────────────────────────────────────
    PROJECT_FLOW_AI_PROJECT_SUMMARY: 'pf:ai-project-summary',
    PROJECT_FLOW_AI_TEAM_SUMMARY: 'pf:ai-team-summary',
    PROJECT_FLOW_AI_QUOTA: 'pf:ai-quota',

    /** SignalR push 收到 project-flow.* action 時轉發到 renderer */
    PUSH_PROJECT_FLOW_EVENT: 'push:project-flow-event',
} as const
