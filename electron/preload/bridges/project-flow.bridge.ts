/**
 * ProjectFlow bridge — desktop renderer 對後端 tmbom /api/projectflow/* 的入口。
 * ctx 內含 baseUrl / userId(工號)+ 預留 token;由 renderer 從 authStore 拿。
 *
 * 後端 [AllowAnonymous] 不校驗 JWT,只看 query 上的 userId;token 預留欄位(無害,
 * 與其他 controller 共用 baseUrl 時帶上)。
 *
 * 統一回 {ok: true, data} | {ok: false, error}(對齊 IPC handler safeRun 包裝)。
 */
import type {IpcRenderer} from 'electron'

interface Ctx {
    baseUrl: string;
    userId: string;
    token?: string
}

type Ok<T> = { ok: true; data: T }
type Err = { ok: false; error: string }
type Result<T> = Ok<T> | Err

export interface ProjectFlowChannelMap {
    [key: string]: string
}

export function createProjectFlowBridge(ipc: IpcRenderer, ch: ProjectFlowChannelMap) {
    const c = (action: string, args: object = {}) => ipc.invoke(action, args)

    return {
        // Projects
        listProjects: (ctx: Ctx, query: object) =>
            c(ch.PROJECT_FLOW_LIST_PROJECTS, {ctx, query}) as Promise<Result<unknown>>,
        getProject: (ctx: Ctx, projectId: number) =>
            c(ch.PROJECT_FLOW_GET_PROJECT, {ctx, projectId}) as Promise<Result<unknown>>,
        createProject: (ctx: Ctx, body: object) =>
            c(ch.PROJECT_FLOW_CREATE_PROJECT, {ctx, body}) as Promise<Result<{ projectId: number }>>,
        updateProject: (ctx: Ctx, projectId: number, body: object) =>
            c(ch.PROJECT_FLOW_UPDATE_PROJECT, {ctx, projectId, body}) as Promise<Result<unknown>>,
        deleteProject: (ctx: Ctx, projectId: number) =>
            c(ch.PROJECT_FLOW_DELETE_PROJECT, {ctx, projectId}) as Promise<Result<unknown>>,

        // Nodes
        createNode: (ctx: Ctx, projectId: number, body: object) =>
            c(ch.PROJECT_FLOW_CREATE_NODE, {ctx, projectId, body}) as Promise<Result<{ nodeId: number }>>,
        updateNode: (ctx: Ctx, nodeId: number, body: object) =>
            c(ch.PROJECT_FLOW_UPDATE_NODE, {ctx, nodeId, body}) as Promise<Result<unknown>>,
        deleteNode: (ctx: Ctx, nodeId: number) =>
            c(ch.PROJECT_FLOW_DELETE_NODE, {ctx, nodeId}) as Promise<Result<unknown>>,
        patchNodeStatus: (ctx: Ctx, nodeId: number, body: object) =>
            c(ch.PROJECT_FLOW_PATCH_NODE_STATUS, {ctx, nodeId, body}) as Promise<Result<unknown>>,
        getNodeProgress: (ctx: Ctx, nodeId: number) =>
            c(ch.PROJECT_FLOW_GET_NODE_PROGRESS, {ctx, nodeId}) as Promise<Result<unknown>>,
        listNodeReportItems: (ctx: Ctx, nodeId: number) =>
            c(ch.PROJECT_FLOW_LIST_NODE_REPORT_ITEMS, {ctx, nodeId}) as Promise<Result<unknown>>,
        listMyNodes: (ctx: Ctx) =>
            c(ch.PROJECT_FLOW_MY_NODES, {ctx}) as Promise<Result<unknown>>,

        // Members
        listMembers: (ctx: Ctx, projectId: number) =>
            c(ch.PROJECT_FLOW_LIST_MEMBERS, {ctx, projectId}) as Promise<Result<unknown>>,
        upsertMember: (ctx: Ctx, projectId: number, body: object) =>
            c(ch.PROJECT_FLOW_UPSERT_MEMBER, {ctx, projectId, body}) as Promise<Result<unknown>>,
        removeMember: (ctx: Ctx, projectId: number, memberUserId: string) =>
            c(ch.PROJECT_FLOW_REMOVE_MEMBER, {ctx, projectId, memberUserId}) as Promise<Result<unknown>>,
        searchEmployees: (ctx: Ctx, query: object) =>
            c(ch.PROJECT_FLOW_SEARCH_EMPLOYEES, {ctx, query}) as Promise<Result<unknown>>,
        todayActivity: () =>
            c(ch.PROJECT_FLOW_TODAY_ACTIVITY, {}) as Promise<Result<unknown>>,

        // Edges
        createEdge: (ctx: Ctx, projectId: number, body: object) =>
            c(ch.PROJECT_FLOW_CREATE_EDGE, {ctx, projectId, body}) as Promise<Result<{ edgeId: number }>>,
        updateEdge: (ctx: Ctx, edgeId: number, body: object) =>
            c(ch.PROJECT_FLOW_UPDATE_EDGE, {ctx, edgeId, body}) as Promise<Result<unknown>>,
        deleteEdge: (ctx: Ctx, edgeId: number) =>
            c(ch.PROJECT_FLOW_DELETE_EDGE, {ctx, edgeId}) as Promise<Result<unknown>>,

        // Reports
        listReports: (ctx: Ctx, query: object) =>
            c(ch.PROJECT_FLOW_LIST_REPORTS, {ctx, query}) as Promise<Result<unknown>>,
        getReport: (ctx: Ctx, reportId: number) =>
            c(ch.PROJECT_FLOW_GET_REPORT, {ctx, reportId}) as Promise<Result<unknown>>,
        createReport: (ctx: Ctx, body: object) =>
            c(ch.PROJECT_FLOW_CREATE_REPORT, {ctx, body}) as Promise<Result<{ reportId: number }>>,
        updateReport: (ctx: Ctx, reportId: number, body: object) =>
            c(ch.PROJECT_FLOW_UPDATE_REPORT, {ctx, reportId, body}) as Promise<Result<unknown>>,
        submitReport: (ctx: Ctx, reportId: number) =>
            c(ch.PROJECT_FLOW_SUBMIT_REPORT, {ctx, reportId}) as Promise<Result<unknown>>,
        deleteReport: (ctx: Ctx, reportId: number) =>
            c(ch.PROJECT_FLOW_DELETE_REPORT, {ctx, reportId}) as Promise<Result<unknown>>,

        // Memos
        listMemos: (ctx: Ctx, query: object) =>
            c(ch.PROJECT_FLOW_LIST_MEMOS, {ctx, query}) as Promise<Result<unknown>>,
        createMemo: (ctx: Ctx, body: object) =>
            c(ch.PROJECT_FLOW_CREATE_MEMO, {ctx, body}) as Promise<Result<{ memoId: number }>>,
        updateMemo: (ctx: Ctx, memoId: number, body: object) =>
            c(ch.PROJECT_FLOW_UPDATE_MEMO, {ctx, memoId, body}) as Promise<Result<unknown>>,
        setMemoStatus: (ctx: Ctx, memoId: number, body: object) =>
            c(ch.PROJECT_FLOW_SET_MEMO_STATUS, {ctx, memoId, body}) as Promise<Result<unknown>>,
        deleteMemo: (ctx: Ctx, memoId: number) =>
            c(ch.PROJECT_FLOW_DELETE_MEMO, {ctx, memoId}) as Promise<Result<unknown>>,

        // Feedback
        createFeedback: (ctx: Ctx, body: object) =>
            c(ch.PROJECT_FLOW_CREATE_FEEDBACK, {ctx, body}) as Promise<Result<{ feedbackId: number }>>,
        listFeedbackByTarget: (ctx: Ctx, targetType: string, targetId: number) =>
            c(ch.PROJECT_FLOW_LIST_FEEDBACK_BY_TARGET, {ctx, targetType, targetId}) as Promise<Result<unknown>>,
        listMyUnread: (ctx: Ctx) =>
            c(ch.PROJECT_FLOW_LIST_MY_UNREAD, {ctx}) as Promise<Result<unknown>>,
        countMyUnread: (ctx: Ctx) =>
            c(ch.PROJECT_FLOW_COUNT_MY_UNREAD, {ctx}) as Promise<Result<{ count: number }>>,
        markFeedbackRead: (ctx: Ctx, feedbackId: number) =>
            c(ch.PROJECT_FLOW_MARK_FEEDBACK_READ, {ctx, feedbackId}) as Promise<Result<unknown>>,

        // Team
        listSubordinates: (ctx: Ctx, query: object = {}) =>
            c(ch.PROJECT_FLOW_LIST_SUBORDINATES, {ctx, query}) as Promise<Result<unknown>>,
        listSubReports: (ctx: Ctx, userId: string, query: object) =>
            c(ch.PROJECT_FLOW_LIST_SUB_REPORTS, {ctx, userId, query}) as Promise<Result<unknown>>,
        listSubMemos: (ctx: Ctx, userId: string) =>
            c(ch.PROJECT_FLOW_LIST_SUB_MEMOS, {ctx, userId}) as Promise<Result<unknown>>,

        // AI server-side
        aiProjectSummary: (ctx: Ctx, body: object) =>
            c(ch.PROJECT_FLOW_AI_PROJECT_SUMMARY, {ctx, body}) as Promise<Result<unknown>>,
        aiTeamSummary: (ctx: Ctx, body: object) =>
            c(ch.PROJECT_FLOW_AI_TEAM_SUMMARY, {ctx, body}) as Promise<Result<unknown>>,
        getQuota: (ctx: Ctx) =>
            c(ch.PROJECT_FLOW_AI_QUOTA, {ctx}) as Promise<Result<unknown>>,

        // AI local — 教練模式:回建議,不代寫
        aiReportAdvice: (ctx: Ctx, body: object) =>
            c(ch.PROJECT_FLOW_AI_REPORT_ADVICE, {ctx, body}) as Promise<Result<unknown>>,
        aiMemoSuggest: (ctx: Ctx, body: object) =>
            c(ch.PROJECT_FLOW_AI_MEMO_SUGGEST, {ctx, body}) as Promise<Result<unknown>>,
    }
}
