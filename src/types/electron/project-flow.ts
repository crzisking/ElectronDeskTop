/**
 * electronAPI.projectFlow 子介面 — 對齊 preload/bridges/project-flow.bridge.ts。
 * 每個 method 接 ctx + 業務 args,返回統一 {ok, data} | {ok, error} envelope。
 */

// userId = 工號;對齊後端 [AllowAnonymous] + [FromQuery] string userId
interface Ctx {
    baseUrl: string;
    userId: string;
    token?: string
}

type Ok<T> = { ok: true; data: T }
type Err = { ok: false; error: string }
type Result<T> = Ok<T> | Err

export interface ProjectFlowAPI {
    // Projects
    listProjects: (ctx: Ctx, query: object) => Promise<Result<unknown>>
    getProject: (ctx: Ctx, projectId: number) => Promise<Result<unknown>>
    createProject: (ctx: Ctx, body: object) => Promise<Result<{ projectId: number }>>
    updateProject: (ctx: Ctx, projectId: number, body: object) => Promise<Result<unknown>>
    deleteProject: (ctx: Ctx, projectId: number) => Promise<Result<unknown>>

    // Nodes
    createNode: (ctx: Ctx, projectId: number, body: object) => Promise<Result<{ nodeId: number }>>
    updateNode: (ctx: Ctx, nodeId: number, body: object) => Promise<Result<unknown>>
    deleteNode: (ctx: Ctx, nodeId: number) => Promise<Result<unknown>>
    patchNodeStatus: (ctx: Ctx, nodeId: number, body: object) => Promise<Result<unknown>>
    getNodeProgress: (ctx: Ctx, nodeId: number) => Promise<Result<unknown>>
    listNodeReportItems: (ctx: Ctx, nodeId: number) => Promise<Result<unknown>>
    listMyNodes: (ctx: Ctx) => Promise<Result<unknown>>
    searchEmployees: (ctx: Ctx, query: object) => Promise<Result<unknown>>
    todayActivity: () => Promise<Result<unknown>>

    // Members
    listMembers: (ctx: Ctx, projectId: number) => Promise<Result<unknown>>
    upsertMember: (ctx: Ctx, projectId: number, body: object) => Promise<Result<unknown>>
    removeMember: (ctx: Ctx, projectId: number, memberUserId: string) => Promise<Result<unknown>>

    // Edges
    createEdge: (ctx: Ctx, projectId: number, body: object) => Promise<Result<{ edgeId: number }>>
    updateEdge: (ctx: Ctx, edgeId: number, body: object) => Promise<Result<unknown>>
    deleteEdge: (ctx: Ctx, edgeId: number) => Promise<Result<unknown>>

    // Reports
    listReports: (ctx: Ctx, query: object) => Promise<Result<unknown>>
    getReport: (ctx: Ctx, reportId: number) => Promise<Result<unknown>>
    createReport: (ctx: Ctx, body: object) => Promise<Result<{ reportId: number }>>
    updateReport: (ctx: Ctx, reportId: number, body: object) => Promise<Result<unknown>>
    submitReport: (ctx: Ctx, reportId: number) => Promise<Result<unknown>>
    deleteReport: (ctx: Ctx, reportId: number) => Promise<Result<unknown>>

    // Memos
    listMemos: (ctx: Ctx, query: object) => Promise<Result<unknown>>
    createMemo: (ctx: Ctx, body: object) => Promise<Result<{ memoId: number }>>
    updateMemo: (ctx: Ctx, memoId: number, body: object) => Promise<Result<unknown>>
    setMemoStatus: (ctx: Ctx, memoId: number, body: object) => Promise<Result<unknown>>
    deleteMemo: (ctx: Ctx, memoId: number) => Promise<Result<unknown>>

    // Feedback
    createFeedback: (ctx: Ctx, body: object) => Promise<Result<{ feedbackId: number }>>
    listFeedbackByTarget: (ctx: Ctx, targetType: string, targetId: number) => Promise<Result<unknown>>
    listMyUnread: (ctx: Ctx) => Promise<Result<unknown>>
    countMyUnread: (ctx: Ctx) => Promise<Result<{ count: number }>>
    markFeedbackRead: (ctx: Ctx, feedbackId: number) => Promise<Result<unknown>>

    // Team
    listSubordinates: (ctx: Ctx, query?: object) => Promise<Result<unknown>>
    listSubReports: (ctx: Ctx, userId: string, query: object) => Promise<Result<unknown>>
    listSubMemos: (ctx: Ctx, userId: string) => Promise<Result<unknown>>

    // AI
    aiProjectSummary: (ctx: Ctx, body: object) => Promise<Result<unknown>>
    aiTeamSummary: (ctx: Ctx, body: object) => Promise<Result<unknown>>
    getQuota: (ctx: Ctx) => Promise<Result<unknown>>
    aiReportAdvice: (ctx: Ctx, body: object) => Promise<Result<unknown>>
    aiMemoSuggest: (ctx: Ctx, body: object) => Promise<Result<unknown>>
}
