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

/** 通用解 envelope 包裝 */
async function unwrap<T>(promise: Promise<{ ok: true; data: T } | { ok: false; error: string }>): Promise<T> {
    const r = await promise
    if (r.ok) return r.data
    throw new Error(r.error)
}

/**
 * 出境參數淨化 — Vue 的 reactive/ref 是 Proxy,Electron IPC 的 structured clone
 * 不能序列化 Proxy(報「An object could not be cloned」)。
 * 所有 body / query 過 IPC 前先 JSON 走一圈轉成純物件(順帶剝掉 undefined / function)。
 */
function plain<T extends object>(obj: T): T {
    return JSON.parse(JSON.stringify(obj)) as T
}

const pf = () => window.electronAPI.projectFlow

export const projectFlowApi = {
    // ── Projects ──
    listProjects: (query: object = {}) => unwrap(pf().listProjects(ctx(), plain(query))),
    getProject: (id: number) => unwrap(pf().getProject(ctx(), id)),
    createProject: (body: object) => unwrap(pf().createProject(ctx(), plain(body))),
    updateProject: (id: number, body: object) => unwrap(pf().updateProject(ctx(), id, plain(body))),
    deleteProject: (id: number) => unwrap(pf().deleteProject(ctx(), id)),

    // ── Nodes ──
    createNode: (projectId: number, body: object) => unwrap(pf().createNode(ctx(), projectId, plain(body))),
    updateNode: (nodeId: number, body: object) => unwrap(pf().updateNode(ctx(), nodeId, plain(body))),
    deleteNode: (nodeId: number) => unwrap(pf().deleteNode(ctx(), nodeId)),
    patchNodeStatus: (nodeId: number, body: object) => unwrap(pf().patchNodeStatus(ctx(), nodeId, plain(body))),
    getNodeProgress: (nodeId: number) => unwrap(pf().getNodeProgress(ctx(), nodeId)),
    listNodeReportItems: (nodeId: number) => unwrap(pf().listNodeReportItems(ctx(), nodeId)),
    /** 跨項目「我的節點」(個人時間線 / 備忘 AI 進度輸入) */
    listMyNodes: () => unwrap(pf().listMyNodes(ctx())),
    /** 員工模糊搜尋(工號/姓名/電話)— 負責人選擇彈窗用 */
    searchEmployees: (query: { keyword?: string; pageIndex?: number; pageSize?: number }) =>
        unwrap(pf().searchEmployees(ctx(), plain(query))),
    /** 今日 work-collect 聚合(唯讀參考,純本地不打後端) */
    todayActivity: () => unwrap(pf().todayActivity()),

    // ── Edges ──
    createEdge: (projectId: number, body: object) => unwrap(pf().createEdge(ctx(), projectId, plain(body))),
    updateEdge: (edgeId: number, body: object) => unwrap(pf().updateEdge(ctx(), edgeId, plain(body))),
    deleteEdge: (edgeId: number) => unwrap(pf().deleteEdge(ctx(), edgeId)),

    // ── Reports ──
    listReports: (query: object = {}) => unwrap(pf().listReports(ctx(), plain(query))),
    getReport: (id: number) => unwrap(pf().getReport(ctx(), id)),
    createReport: (body: object) => unwrap(pf().createReport(ctx(), plain(body))),
    updateReport: (id: number, body: object) => unwrap(pf().updateReport(ctx(), id, plain(body))),
    submitReport: (id: number) => unwrap(pf().submitReport(ctx(), id)),
    deleteReport: (id: number) => unwrap(pf().deleteReport(ctx(), id)),

    // ── Memos ──
    listMemos: (query: object = {}) => unwrap(pf().listMemos(ctx(), plain(query))),
    createMemo: (body: object) => unwrap(pf().createMemo(ctx(), plain(body))),
    updateMemo: (id: number, body: object) => unwrap(pf().updateMemo(ctx(), id, plain(body))),
    setMemoStatus: (id: number, body: object) => unwrap(pf().setMemoStatus(ctx(), id, plain(body))),
    deleteMemo: (id: number) => unwrap(pf().deleteMemo(ctx(), id)),

    // ── Feedback ──
    createFeedback: (body: object) => unwrap(pf().createFeedback(ctx(), plain(body))),
    listFeedbackByTarget: (targetType: string, targetId: number) =>
        unwrap(pf().listFeedbackByTarget(ctx(), targetType, targetId)),
    listMyUnread: () => unwrap(pf().listMyUnread(ctx())),
    countMyUnread: () => unwrap(pf().countMyUnread(ctx())),
    markFeedbackRead: (id: number) => unwrap(pf().markFeedbackRead(ctx(), id)),

    // ── Team ──
    listSubordinates: (query: { keyword?: string; pageIndex?: number; pageSize?: number } = {}) =>
        unwrap(pf().listSubordinates(ctx(), plain(query))),
    // ── Members(成員制權限) ──
    listMembers: (projectId: number) => unwrap(pf().listMembers(ctx(), projectId)),
    upsertMember: (projectId: number, body: { userId: string; role: 'viewer' | 'editor' }) =>
        unwrap(pf().upsertMember(ctx(), projectId, plain(body))),
    removeMember: (projectId: number, memberUserId: string) =>
        unwrap(pf().removeMember(ctx(), projectId, memberUserId)),
    listSubReports: (userId: string, query: object = {}) =>
        unwrap(pf().listSubReports(ctx(), userId, plain(query))),
    listSubMemos: (userId: string) => unwrap(pf().listSubMemos(ctx(), userId)),

    // ── AI ──
    aiProjectSummary: (body: object) => unwrap(pf().aiProjectSummary(ctx(), plain(body))),
    aiTeamSummary: (body: object) => unwrap(pf().aiTeamSummary(ctx(), plain(body))),
    getQuota: () => unwrap(pf().getQuota(ctx())),
    // 本地 AI(教練模式):建議不代寫
    aiReportAdvice: (body: object) => unwrap(pf().aiReportAdvice(ctx(), plain(body))),
    aiMemoSuggest: (body: object) => unwrap(pf().aiMemoSuggest(ctx(), plain(body))),
}
