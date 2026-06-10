/**
 * 項目流程圖 + 工作匯報 + 智能備忘錄(docs/20)— 跨進程型別契約。
 * 對應後端 ichia.Model.Response.ProjectFlowResponses.cs 的 DTO 結構。
 * 時間統一 Unix ms。
 */

// ─── Common ─────────────────────────────────────────────────

export interface PagedResult<T> {
    pageIndex: number
    pageSize: number
    total: number
    list: T
}

// ─── Project / Node / Edge ──────────────────────────────────

export interface ProjectListItem {
    projectId: number
    name: string
    description?: string
    ownerUserId: string
    status: string
    coverColor?: string
    nodeCount: number
    completedCount: number
    progressPercent: number
    updatedAt: number
}

export type NodeStatus = 'not_started' | 'in_progress' | 'blocked' | 'completed' | 'cancelled'
export type NodeType = 'task' | 'milestone' | 'decision'

export interface NodeResponse {
    nodeId: number
    projectId: number
    title: string
    description?: string
    status: NodeStatus
    assigneeUserId?: string
    deadline?: number
    priority: number
    positionX: number
    positionY: number
    width: number
    height: number
    color?: string
    nodeType: NodeType
    parentNodeId?: number
    extraJson?: string
    sortOrder: number
    updatedAt: number
}

export interface EdgeResponse {
    edgeId: number
    projectId: number
    sourceNodeId: number
    targetNodeId: number
    label?: string
    styleJson?: string
}

/** Canvas inspector 顯示掛在 node 上的匯報項目(對齊後端 NodeLinkedReportItem) */
export interface NodeLinkedReportItem {
    itemId: number
    reportId: number
    itemType: 'work' | 'issue' | 'plan'
    content: string
    needHelp: boolean
    reportTitle: string
    reportUserId: string
    reportStatus: 'draft' | 'submitted' | 'archived'
    submittedAt?: number
    createdAt: number
}

export interface NodeProgressItem {
    progressId: number
    nodeId: number
    userId: string
    oldStatus?: string
    newStatus: string
    note?: string
    createdAt: number
}

/** 我在項目中的角色 — 後端 ResolveRoleAsync 的結果,前端據此切唯讀 */
export type ProjectRole = 'owner' | 'editor' | 'viewer'

export interface ProjectDetailResponse {
    project: ProjectListItem
    nodes: NodeResponse[]
    edges: EdgeResponse[]
    myRole: ProjectRole
}

/** 項目成員(owner 由後端合成在第一筆) */
export interface ProjectMemberItem {
    userId: string
    name?: string
    role: ProjectRole
    createdAt?: number
}

// ─── Report ─────────────────────────────────────────────────

export type ReportItemType = 'work' | 'issue' | 'plan'
export type ReportStatus = 'draft' | 'submitted' | 'archived'

export interface ReportItem {
    itemId: number
    reportId: number
    itemType: ReportItemType
    content: string
    needHelp: boolean
    projectId?: number
    nodeId?: number
    sortOrder: number
}

export interface ReportResponse {
    reportId: number
    userId: string
    reportType: 'daily' | 'weekly'
    title: string
    aiGenerated: boolean
    status: ReportStatus
    submittedAt?: number
    createdAt: number
    updatedAt: number
    items: ReportItem[]
}

export interface ReportSummaryItem {
    reportId: number
    title: string
    reportType: 'daily' | 'weekly'
    status: ReportStatus
    submittedAt?: number
    createdAt: number
    workCount: number
    issueCount: number
    planCount: number
}

// ─── Memo ───────────────────────────────────────────────────

export type MemoStatus = 'pending' | 'done' | 'dismissed'
export type MemoSource = 'manual' | 'ai-suggestion'

export interface MemoResponse {
    memoId: number
    userId: string
    title: string
    description?: string
    dueDate?: number
    priority: number
    status: MemoStatus
    source: MemoSource
    linkedProjectId?: number
    linkedNodeId?: number
    aiReasoning?: string
    completedAt?: number
    createdAt: number
    updatedAt: number
}

// ─── 我的節點(跨項目,後端 GET /my-nodes) ──────────────────

export interface MyNodeItem {
    nodeId: number
    projectId: number
    projectName: string
    title: string
    status: NodeStatus
    nodeType: NodeType
    priority: number
    /** 截止時間 unix ms;無為 null */
    deadline?: number | null
}

// ─── 員工搜尋(後端 /api/employee/getEmployees) ─────────────

export interface EmployeeItem {
    empNo: string
    name: string
    userName?: string
    englishName?: string
    job?: string
    phoneNo?: string
    email?: string
}

// ─── 今日活動聚合(work-collect 唯讀參考) ───────────────────

export interface TodayActivityCategory {
    category: string
    /** 估算分鐘數(採集間隔 5 分鐘 × 筆數) */
    minutes: number
    /** 主要應用(最多 5 個) */
    apps: string[]
}

// ─── Feedback ───────────────────────────────────────────────

export type FeedbackTargetType = 'node' | 'report'

export interface FeedbackResponse {
    feedbackId: number
    targetType: FeedbackTargetType
    targetId: number
    fromUserId: string
    toUserId: string
    content: string
    isRead: boolean
    createdAt: number
}

// ─── Team ───────────────────────────────────────────────────

export interface TeamSubordinateItem {
    userId: string
    name?: string
    deptNo?: string
    activeProjectCount: number
    pendingFeedbackCount: number
    lastReportAt?: number
}

// ─── AI ─────────────────────────────────────────────────────

export type AiActionType = 'report-generate' | 'project-summary' | 'team-summary' | 'memo-suggestion'

export interface AiQuotaInfo {
    quotas: Record<AiActionType, { limit: number; used: number; remaining: number }>
}

export interface AiQuotaConsumeResult {
    ok: boolean
    reason?: string
    remaining: number
}

export interface AiProjectSummary {
    overallStatus: 'on_track' | 'at_risk' | 'blocked' | 'completed'
    summary: string
    progress: { totalNodes: number; completedNodes: number; percentage: number }
    highlights: { title: string; detail: string }[]
    blockers: { nodeTitle: string; issue: string; suggestion: string }[]
    upcomingDeadlines: { nodeTitle: string; deadline: string; daysLeft: number }[]
    suggestedActions: string[]
}

/**
 * AI 寫作教練的回覆 — 給「怎麼寫」的建議,不代寫內容。
 * ideas: 可以寫什麼方向;polish: 針對既有草稿的潤色建議;missing: 可能遺漏的點。
 */
export interface AiReportAdvice {
    ideas: string[]
    polish: { original: string; suggestion: string }[]
    missing: string[]
}

export interface AiMemoSuggestion {
    title: string
    description: string
    priority: number
    dueDate?: string
    reasoning: string
    suggestedProjectId?: number
    suggestedNodeId?: number
}

// ─── SignalR Push payload(對齊後端 INotificationSender.SendTaskToConnectionsAsync) ─

export interface ProjectFlowEventPayload {
    /** project-flow.feedback-new / project-flow.report-submitted */
    action: string
    payload: unknown
}
