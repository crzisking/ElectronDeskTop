/**
 * 項目流程圖 IPC handler(docs/20)— 純通道註冊層。
 *
 * 模式跟 work-collect.handlers.ts 同:
 *   - renderer invoke 帶 {ctx: {baseUrl, userId, token}, ...args}
 *   - handler 呼叫 projectFlowApi(轉 fetch 給 tmbom 後端)
 *   - 失敗統一回 {ok:false, error}
 *
 * 業務邏輯不放這裡:
 *   - HTTP 轉發 → services/project-flow/api-client.ts
 *   - 本地 AI(寫作建議 / 備忘建議)→ services/project-flow/ai-local.ts
 *
 * 為什麼 renderer 不直接打後端:統一在主進程做請求,未來加 retry / cache / 離線降級集中一處。
 */

import {ipcMain} from 'electron'
import {IpcChannels} from '../../shared/ipc-channels'
import {projectFlowApi, type ProjectFlowApiContext} from '../services/project-flow/api-client'
import {
    generateMemoSuggestions,
    generateReportAdvice,
    summarizeTodayActivityFromService,
} from '../services/project-flow/ai-local'
import {generateGraphPlan, type GraphPlanInput} from '../services/project-flow/ai-graph'
import {authContext} from '../services/auth-context'
import type {LlmClient} from '../services/llm'
import type {WorkRecordService} from '../db/features/work-collect/service'

/** 註冊 handler 時注入的相依;AI 本地端點要用 */
interface ProjectFlowHandlerDeps {
    llmClient: LlmClient | null
    workRecordService: WorkRecordService | null
}

/** invoke payload 統一形狀:第一個欄位放 ctx,其餘是業務參數 */
interface InvokePayload {
    ctx?: ProjectFlowApiContext
    [key: string]: unknown
}

function getCtx(payload: InvokePayload | undefined): ProjectFlowApiContext | null {
    // 主窗顯式傳 ctx → 採用;子視窗(Memos / LogViewer)沒帶 ctx → 走主進程 authContext
    if (payload?.ctx?.baseUrl && payload?.ctx?.userId) return payload.ctx
    const a = authContext.get()
    if (!a.userId) return null
    return {baseUrl: a.baseUrl, userId: a.userId, token: a.token}
}

/** 統一錯誤包裝 — handler 回 result 物件,不擴散異常給 renderer */
async function safeRun<T>(fn: () => Promise<T>): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
    try {
        return {ok: true, data: await fn()}
    } catch (err) {
        return {ok: false, error: err instanceof Error ? err.message : String(err)}
    }
}

/**
 * 樣板收斂:取 ctx → 失敗回 missing ctx → safeRun 包業務呼叫。
 * 之前 40 個 handler 各重複一遍這三行,改一處全生效。
 */
function handleWithCtx(
    channel: string,
    fn: (ctx: ProjectFlowApiContext, p: InvokePayload) => Promise<unknown>,
): void {
    ipcMain.handle(channel, async (_e, p: InvokePayload) => {
        const ctx = getCtx(p)
        if (!ctx) return {ok: false, error: 'missing ctx'}
        return safeRun(() => fn(ctx, p))
    })
}

export function registerProjectFlowHandlers(
    deps: ProjectFlowHandlerDeps = {llmClient: null, workRecordService: null},
): void {
    const ch = IpcChannels
    const api = projectFlowApi

    // ── Projects ────────────────────────────────────────────
    handleWithCtx(ch.PROJECT_FLOW_LIST_PROJECTS, (ctx, p) => api.listProjects(ctx, (p.query as object) ?? {}))
    handleWithCtx(ch.PROJECT_FLOW_GET_PROJECT, (ctx, p) => api.getProject(ctx, p.projectId as number))
    handleWithCtx(ch.PROJECT_FLOW_CREATE_PROJECT, (ctx, p) => api.createProject(ctx, p.body))
    handleWithCtx(ch.PROJECT_FLOW_UPDATE_PROJECT, (ctx, p) => api.updateProject(ctx, p.projectId as number, p.body))
    handleWithCtx(ch.PROJECT_FLOW_DELETE_PROJECT, (ctx, p) => api.deleteProject(ctx, p.projectId as number))

    // ── Members(成員制權限) ────────────────────────────────
    handleWithCtx(ch.PROJECT_FLOW_LIST_MEMBERS, (ctx, p) => api.listMembers(ctx, p.projectId as number))
    handleWithCtx(ch.PROJECT_FLOW_UPSERT_MEMBER, (ctx, p) => api.upsertMember(ctx, p.projectId as number, p.body))
    handleWithCtx(ch.PROJECT_FLOW_REMOVE_MEMBER, (ctx, p) =>
        api.removeMember(ctx, p.projectId as number, p.memberUserId as string))

    // ── Nodes ───────────────────────────────────────────────
    handleWithCtx(ch.PROJECT_FLOW_CREATE_NODE, (ctx, p) => api.createNode(ctx, p.projectId as number, p.body))
    handleWithCtx(ch.PROJECT_FLOW_UPDATE_NODE, (ctx, p) => api.updateNode(ctx, p.nodeId as number, p.body))
    handleWithCtx(ch.PROJECT_FLOW_DELETE_NODE, (ctx, p) => api.deleteNode(ctx, p.nodeId as number))
    handleWithCtx(ch.PROJECT_FLOW_PATCH_NODE_STATUS, (ctx, p) => api.patchNodeStatus(ctx, p.nodeId as number, p.body))
    handleWithCtx(ch.PROJECT_FLOW_GET_NODE_PROGRESS, (ctx, p) => api.getNodeProgress(ctx, p.nodeId as number))
    handleWithCtx(ch.PROJECT_FLOW_LIST_NODE_REPORT_ITEMS, (ctx, p) => api.listNodeReportItems(ctx, p.nodeId as number))
    handleWithCtx(ch.PROJECT_FLOW_MY_NODES, (ctx) => api.listMyNodes(ctx))
    handleWithCtx(ch.PROJECT_FLOW_SEARCH_EMPLOYEES, (ctx, p) => api.searchEmployees(ctx, (p.query as object) ?? {}))

    // 今日活動摘要 — 純本地讀 work-collect,不打後端(匯報編輯器參考面板 + 首頁熱力圖)
    ipcMain.handle(ch.PROJECT_FLOW_TODAY_ACTIVITY, async () =>
        safeRun(async () => {
            if (!deps.workRecordService) throw new Error('工作採集服務未就緒')
            return summarizeTodayActivityFromService(deps.workRecordService)
        }))

    // ── Edges ───────────────────────────────────────────────
    handleWithCtx(ch.PROJECT_FLOW_CREATE_EDGE, (ctx, p) => api.createEdge(ctx, p.projectId as number, p.body))
    handleWithCtx(ch.PROJECT_FLOW_DELETE_EDGE, (ctx, p) => api.deleteEdge(ctx, p.edgeId as number))

    // ── Reports ─────────────────────────────────────────────
    handleWithCtx(ch.PROJECT_FLOW_LIST_REPORTS, (ctx, p) => api.listReports(ctx, (p.query as object) ?? {}))
    handleWithCtx(ch.PROJECT_FLOW_GET_REPORT, (ctx, p) => api.getReport(ctx, p.reportId as number))
    handleWithCtx(ch.PROJECT_FLOW_CREATE_REPORT, (ctx, p) => api.createReport(ctx, p.body))
    handleWithCtx(ch.PROJECT_FLOW_UPDATE_REPORT, (ctx, p) => api.updateReport(ctx, p.reportId as number, p.body))
    handleWithCtx(ch.PROJECT_FLOW_SUBMIT_REPORT, (ctx, p) => api.submitReport(ctx, p.reportId as number))
    handleWithCtx(ch.PROJECT_FLOW_DELETE_REPORT, (ctx, p) => api.deleteReport(ctx, p.reportId as number))

    // ── Memos ───────────────────────────────────────────────
    handleWithCtx(ch.PROJECT_FLOW_LIST_MEMOS, (ctx, p) => api.listMemos(ctx, (p.query as object) ?? {}))
    handleWithCtx(ch.PROJECT_FLOW_CREATE_MEMO, (ctx, p) => api.createMemo(ctx, p.body))
    handleWithCtx(ch.PROJECT_FLOW_UPDATE_MEMO, (ctx, p) => api.updateMemo(ctx, p.memoId as number, p.body))
    handleWithCtx(ch.PROJECT_FLOW_SET_MEMO_STATUS, (ctx, p) => api.setMemoStatus(ctx, p.memoId as number, p.body))
    handleWithCtx(ch.PROJECT_FLOW_DELETE_MEMO, (ctx, p) => api.deleteMemo(ctx, p.memoId as number))

    // ── Feedback ────────────────────────────────────────────
    handleWithCtx(ch.PROJECT_FLOW_CREATE_FEEDBACK, (ctx, p) => api.createFeedback(ctx, p.body))
    handleWithCtx(ch.PROJECT_FLOW_LIST_FEEDBACK_BY_TARGET, (ctx, p) =>
        api.listFeedbackByTarget(ctx, {targetType: p.targetType as string, targetId: p.targetId as number}))
    handleWithCtx(ch.PROJECT_FLOW_LIST_MY_UNREAD, (ctx) => api.listMyUnread(ctx))
    handleWithCtx(ch.PROJECT_FLOW_COUNT_MY_UNREAD, (ctx) => api.countMyUnread(ctx))
    handleWithCtx(ch.PROJECT_FLOW_MARK_FEEDBACK_READ, (ctx, p) => api.markFeedbackRead(ctx, p.feedbackId as number))

    // ── Team ────────────────────────────────────────────────
    handleWithCtx(ch.PROJECT_FLOW_LIST_SUBORDINATES, (ctx, p) => api.listSubordinates(ctx, (p.query as object) ?? {}))
    handleWithCtx(ch.PROJECT_FLOW_LIST_SUB_REPORTS, (ctx, p) =>
        api.listSubReports(ctx, p.userId as string, (p.query as object) ?? {}))
    handleWithCtx(ch.PROJECT_FLOW_LIST_SUB_MEMOS, (ctx, p) => api.listSubMemos(ctx, p.userId as string))

    // ── AI server-side ──────────────────────────────────────
    handleWithCtx(ch.PROJECT_FLOW_AI_PROJECT_SUMMARY, (ctx, p) => api.aiProjectSummary(ctx, p.body))
    handleWithCtx(ch.PROJECT_FLOW_AI_TEAM_SUMMARY, (ctx, p) => api.aiTeamSummary(ctx, p.body))
    handleWithCtx(ch.PROJECT_FLOW_AI_QUOTA, (ctx) => api.getQuota(ctx))

    // ── AI 本地(寫作建議 / 備忘建議)— 走本地 LlmClient,不消耗後端配額 ──
    ipcMain.handle(ch.PROJECT_FLOW_AI_MEMO_SUGGEST, async (_e, p: InvokePayload) =>
        safeRun(() => generateMemoSuggestions(deps.llmClient, (p?.body as object) ?? {})))

    ipcMain.handle(ch.PROJECT_FLOW_AI_REPORT_ADVICE, async (_e, p: InvokePayload) =>
        safeRun(() => generateReportAdvice(deps.llmClient, deps.workRecordService, (p?.body as object) ?? {})))

    // AI 改圖 — 自然語言需求 + 當前圖 → 操作清單;不打後端,純本地 LLM
    ipcMain.handle(ch.PROJECT_FLOW_AI_GRAPH_PLAN, async (_e, p: InvokePayload) =>
        safeRun(() => generateGraphPlan(deps.llmClient, (p?.body as GraphPlanInput))))
}
