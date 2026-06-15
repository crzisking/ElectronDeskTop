/**
 * project-flow renderer ↔ main 的 API 包裝層。
 *
 * 不直接走 HTTP — 全部透過 window.electronAPI.projectFlow.* 走 IPC,由 main 進程
 * 統一帶 baseUrl + JWT 打後端,renderer 不接觸 token(對齊架構文件 §內存 token)。
 *
 * 每個 method 解 envelope:{ok:true, data} 直接回 data, {ok:false, error} 拋例外。
 * Store 層只需要 try/catch,不必反覆 if (ok).
 */

import {useAuthStore} from '@/stores/auth.store'
import {plain} from '@/shared/utils/ipc-clone'
import type {
    AiGraphPlan,
    AiQuotaInfo,
    AiReportAdvice,
    EmployeeItem,
    FeedbackResponse,
    MemoResponse,
    MyNodeItem,
    NodeLinkedReportItem,
    NodeProgressInfo,
    PagedResult,
    ProjectDetailResponse,
    ProjectListItem,
    ProjectMemberItem,
    ReportResponse,
    ReportSummaryItem,
    TeamSubordinateItem,
    TodayActivitySummary,
} from './types'

/** 後端 AI summary 端點的業務信封(cache / 配額語義,與 IPC 信封分離) */
export interface AiSummaryResult {
    ok: boolean
    fromCache: boolean
    contentJson?: string
    error?: string
}

/** 後端 base URL — 跟 work-collect 共用環境變數,生產指向 IES 服器 */
const BASE_URL: string =
    (import.meta.env.VITE_WORK_COLLECT_API_URL as string | undefined) ?? 'http://localhost:5247'

/**
 * 從 authStore 取 ctx。
 *
 * 後端 ProjectFlowController 已 [AllowAnonymous],身分靠 userId(工號)直接寫進 query:
 *   - 必傳 userId — 沒登入(authStore.user 為 null)時為空字串,後端會回 "userId 必填" 之類
 *   - token 預留(非必須),其他 controller 可能仍校驗
 */
function ctx(): { baseUrl: string; userId: string; token: string } {
    const auth = useAuthStore()
    return {
        baseUrl: BASE_URL,
        userId: auth.user?.userName ?? '',
        token: auth.accessToken ?? '',
    }
}

/**
 * 通用解 envelope 包裝。
 * bridge 端統一回 Result<unknown>,真實型別由本檔各 method 的 <T> 宣告 —
 * 型別斷言集中在這一層,view 不需要再 `as XxxResponse`。
 */
async function unwrap<T>(promise: Promise<{ ok: true; data: unknown } | { ok: false; error: string }>): Promise<T> {
    const r = await promise
    if (r.ok) return r.data as T
    throw new Error(r.error)
}

const pf = () => window.electronAPI.projectFlow

export const projectFlowApi = {
    // ── Projects ──
    listProjects: (query: object = {}) =>
        unwrap<PagedResult<ProjectListItem[]>>(pf().listProjects(ctx(), plain(query))),
    getProject: (id: number) => unwrap<ProjectDetailResponse>(pf().getProject(ctx(), id)),
    createProject: (body: object) => unwrap<{ projectId: number }>(pf().createProject(ctx(), plain(body))),
    updateProject: (id: number, body: object) => unwrap<void>(pf().updateProject(ctx(), id, plain(body))),
    deleteProject: (id: number) => unwrap<void>(pf().deleteProject(ctx(), id)),

    // ── Nodes ──
    createNode: (projectId: number, body: object) =>
        unwrap<{ nodeId: number }>(pf().createNode(ctx(), projectId, plain(body))),
    updateNode: (nodeId: number, body: object) => unwrap<void>(pf().updateNode(ctx(), nodeId, plain(body))),
    deleteNode: (nodeId: number) => unwrap<void>(pf().deleteNode(ctx(), nodeId)),
    patchNodeStatus: (nodeId: number, body: object) =>
        unwrap<void>(pf().patchNodeStatus(ctx(), nodeId, plain(body))),
    getNodeProgress: (nodeId: number) => unwrap<NodeProgressInfo[]>(pf().getNodeProgress(ctx(), nodeId)),
    listNodeReportItems: (nodeId: number) =>
        unwrap<NodeLinkedReportItem[]>(pf().listNodeReportItems(ctx(), nodeId)),
    /** 跨項目「我的節點」(個人時間線 / 備忘 AI 進度輸入) */
    listMyNodes: () => unwrap<MyNodeItem[]>(pf().listMyNodes(ctx())),
    /** 員工模糊搜尋(工號/姓名/電話)— 負責人選擇彈窗用 */
    searchEmployees: (query: { keyword?: string; pageIndex?: number; pageSize?: number }) =>
        unwrap<PagedResult<EmployeeItem[]>>(pf().searchEmployees(ctx(), plain(query))),
    /** 今日 work-collect 摘要(類別 + 24h 熱力;唯讀參考,純本地不打後端) */
    todayActivity: () => unwrap<TodayActivitySummary>(pf().todayActivity()),

    // ── Edges ──
    createEdge: (projectId: number, body: object) =>
        unwrap<{ edgeId: number }>(pf().createEdge(ctx(), projectId, plain(body))),
    deleteEdge: (edgeId: number) => unwrap<void>(pf().deleteEdge(ctx(), edgeId)),

    // ── Reports ──
    listReports: (query: object = {}) =>
        unwrap<PagedResult<ReportSummaryItem[]>>(pf().listReports(ctx(), plain(query))),
    getReport: (id: number) => unwrap<ReportResponse>(pf().getReport(ctx(), id)),
    createReport: (body: object) => unwrap<{ reportId: number }>(pf().createReport(ctx(), plain(body))),
    updateReport: (id: number, body: object) => unwrap<void>(pf().updateReport(ctx(), id, plain(body))),
    submitReport: (id: number) => unwrap<void>(pf().submitReport(ctx(), id)),
    deleteReport: (id: number) => unwrap<void>(pf().deleteReport(ctx(), id)),

    // ── Memos ──
    listMemos: (query: object = {}) =>
        unwrap<PagedResult<MemoResponse[]>>(pf().listMemos(ctx(), plain(query))),
    createMemo: (body: object) => unwrap<{ memoId: number }>(pf().createMemo(ctx(), plain(body))),
    updateMemo: (id: number, body: object) => unwrap<void>(pf().updateMemo(ctx(), id, plain(body))),
    setMemoStatus: (id: number, body: object) => unwrap<void>(pf().setMemoStatus(ctx(), id, plain(body))),
    deleteMemo: (id: number) => unwrap<void>(pf().deleteMemo(ctx(), id)),

    // ── Feedback ──
    createFeedback: (body: object) => unwrap<{ feedbackId: number }>(pf().createFeedback(ctx(), plain(body))),
    listFeedbackByTarget: (targetType: string, targetId: number) =>
        unwrap<FeedbackResponse[]>(pf().listFeedbackByTarget(ctx(), targetType, targetId)),
    listMyUnread: () => unwrap<{ items: FeedbackResponse[]; count: number }>(pf().listMyUnread(ctx())),
    countMyUnread: () => unwrap<{ count: number }>(pf().countMyUnread(ctx())),
    markFeedbackRead: (id: number) => unwrap<void>(pf().markFeedbackRead(ctx(), id)),

    // ── Team ──
    listSubordinates: (query: { keyword?: string; pageIndex?: number; pageSize?: number } = {}) =>
        unwrap<PagedResult<TeamSubordinateItem[]>>(pf().listSubordinates(ctx(), plain(query))),
    listSubReports: (userId: string, query: object = {}) =>
        unwrap<PagedResult<ReportSummaryItem[]>>(pf().listSubReports(ctx(), userId, plain(query))),
    listSubMemos: (userId: string) => unwrap<MemoResponse[]>(pf().listSubMemos(ctx(), userId)),

    // ── Members(成員制權限) ──
    listMembers: (projectId: number) => unwrap<ProjectMemberItem[]>(pf().listMembers(ctx(), projectId)),
    upsertMember: (projectId: number, body: { userId: string; role: 'viewer' | 'editor' }) =>
        unwrap<void>(pf().upsertMember(ctx(), projectId, plain(body))),
    removeMember: (projectId: number, memberUserId: string) =>
        unwrap<void>(pf().removeMember(ctx(), projectId, memberUserId)),

    // ── AI ──
    aiProjectSummary: (body: object) => unwrap<AiSummaryResult>(pf().aiProjectSummary(ctx(), plain(body))),
    aiTeamSummary: (body: object) => unwrap<AiSummaryResult>(pf().aiTeamSummary(ctx(), plain(body))),
    getQuota: () => unwrap<AiQuotaInfo>(pf().getQuota(ctx())),
    // 本地 AI(教練模式):建議不代寫
    aiReportAdvice: (body: object) => unwrap<AiReportAdvice>(pf().aiReportAdvice(ctx(), plain(body))),
    aiMemoSuggest: (body: object) =>
        unwrap<{ suggestions: { title: string; description?: string; priority?: number; reasoning?: string }[] }>(
            pf().aiMemoSuggest(ctx(), plain(body))),
    /** AI 改圖:自然語言需求 + 當前圖 → 操作清單(渲染端再 sanitize + 套用) */
    aiGraphPlan: (body: { instruction: string; nodes: object[]; edges: object[] }) =>
        unwrap<AiGraphPlan>(pf().aiGraphPlan(ctx(), plain(body))),
}
