/**
 * 項目流程圖 IPC handler(docs/20)。
 *
 * 模式跟 work-collect.handlers.ts 同:
 *   - renderer invoke 帶 {ctx: {baseUrl, token}, ...args}
 *   - handler 呼叫 projectFlowApi(轉 fetch 給 tmbom 後端)
 *   - 失敗統一回 {ok:false, error}
 *
 * 為什麼 renderer 不直接打後端:跟 work-collect sync 同理 — 統一在主進程做請求,
 * 未來想加 retry / 本地 cache / 離線降級都集中一處。
 */

import {ipcMain} from 'electron'
import {IpcChannels} from '../../shared/ipc-channels'
import {projectFlowApi, type ProjectFlowApiContext} from '../services/project-flow/api-client'
import {authContext} from '../services/auth-context'
import type {LlmClient} from '../services/llm'
import type {WorkRecordService} from '../db/features/work-collect/service'

/** 註冊 handler 時注入的相依;AI 本地兩個端點要用 */
interface ProjectFlowHandlerDeps {
    llmClient: LlmClient | null
    workRecordService: WorkRecordService | null
}

/** 取 ctx + 後續參數;renderer 統一第一個欄位放 ctx */
interface InvokePayload {
    ctx?: ProjectFlowApiContext

    [key: string]: unknown
}

function getCtx(payload: unknown): ProjectFlowApiContext | null {
    const p = payload as InvokePayload | null | undefined
    // 主窗顯式傳 ctx → 採用;子視窗(Memos / LogViewer)沒帶 ctx → 走主進程 authContext
    if (p?.ctx?.baseUrl && p?.ctx?.userId) return p.ctx
    const a = authContext.get()
    if (!a.userId) return null
    return {baseUrl: a.baseUrl, userId: a.userId, token: a.token}
}

/** 統一錯誤包裝 — handler 回 result 物件,不擴散異常給 renderer */
async function safeRun<T>(fn: () => Promise<T>): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
    try {
        const data = await fn()
        return {ok: true, data}
    } catch (err) {
        const error = err instanceof Error ? err.message : String(err)
        return {ok: false, error}
    }
}

export function registerProjectFlowHandlers(deps: ProjectFlowHandlerDeps = {
    llmClient: null,
    workRecordService: null
}): void {
    const ch = IpcChannels

    // ── Projects ────────────────────────────────────────────
    ipcMain.handle(ch.PROJECT_FLOW_LIST_PROJECTS, async (_e, p: any) => {
        const ctx = getCtx(p);
        if (!ctx) return {ok: false, error: 'missing ctx'}
        return safeRun(() => projectFlowApi.listProjects(ctx, p.query ?? {}))
    })
    ipcMain.handle(ch.PROJECT_FLOW_GET_PROJECT, async (_e, p: any) => {
        const ctx = getCtx(p);
        if (!ctx) return {ok: false, error: 'missing ctx'}
        return safeRun(() => projectFlowApi.getProject(ctx, p.projectId))
    })
    ipcMain.handle(ch.PROJECT_FLOW_CREATE_PROJECT, async (_e, p: any) => {
        const ctx = getCtx(p);
        if (!ctx) return {ok: false, error: 'missing ctx'}
        return safeRun(() => projectFlowApi.createProject(ctx, p.body))
    })
    ipcMain.handle(ch.PROJECT_FLOW_UPDATE_PROJECT, async (_e, p: any) => {
        const ctx = getCtx(p);
        if (!ctx) return {ok: false, error: 'missing ctx'}
        return safeRun(() => projectFlowApi.updateProject(ctx, p.projectId, p.body))
    })
    ipcMain.handle(ch.PROJECT_FLOW_DELETE_PROJECT, async (_e, p: any) => {
        const ctx = getCtx(p);
        if (!ctx) return {ok: false, error: 'missing ctx'}
        return safeRun(() => projectFlowApi.deleteProject(ctx, p.projectId))
    })

    // ── Nodes ───────────────────────────────────────────────
    ipcMain.handle(ch.PROJECT_FLOW_CREATE_NODE, async (_e, p: any) => {
        const ctx = getCtx(p);
        if (!ctx) return {ok: false, error: 'missing ctx'}
        return safeRun(() => projectFlowApi.createNode(ctx, p.projectId, p.body))
    })
    ipcMain.handle(ch.PROJECT_FLOW_UPDATE_NODE, async (_e, p: any) => {
        const ctx = getCtx(p);
        if (!ctx) return {ok: false, error: 'missing ctx'}
        return safeRun(() => projectFlowApi.updateNode(ctx, p.nodeId, p.body))
    })
    ipcMain.handle(ch.PROJECT_FLOW_DELETE_NODE, async (_e, p: any) => {
        const ctx = getCtx(p);
        if (!ctx) return {ok: false, error: 'missing ctx'}
        return safeRun(() => projectFlowApi.deleteNode(ctx, p.nodeId))
    })
    ipcMain.handle(ch.PROJECT_FLOW_PATCH_NODE_STATUS, async (_e, p: any) => {
        const ctx = getCtx(p);
        if (!ctx) return {ok: false, error: 'missing ctx'}
        return safeRun(() => projectFlowApi.patchNodeStatus(ctx, p.nodeId, p.body))
    })
    ipcMain.handle(ch.PROJECT_FLOW_GET_NODE_PROGRESS, async (_e, p: any) => {
        const ctx = getCtx(p);
        if (!ctx) return {ok: false, error: 'missing ctx'}
        return safeRun(() => projectFlowApi.getNodeProgress(ctx, p.nodeId))
    })
    ipcMain.handle(ch.PROJECT_FLOW_LIST_NODE_REPORT_ITEMS, async (_e, p: any) => {
        const ctx = getCtx(p);
        if (!ctx) return {ok: false, error: 'missing ctx'}
        return safeRun(() => projectFlowApi.listNodeReportItems(ctx, p.nodeId))
    })
    ipcMain.handle(ch.PROJECT_FLOW_MY_NODES, async (_e, p: any) => {
        const ctx = getCtx(p);
        if (!ctx) return {ok: false, error: 'missing ctx'}
        return safeRun(() => projectFlowApi.listMyNodes(ctx))
    })
    ipcMain.handle(ch.PROJECT_FLOW_LIST_MEMBERS, async (_e, p: any) => {
        const ctx = getCtx(p);
        if (!ctx) return {ok: false, error: 'missing ctx'}
        return safeRun(() => projectFlowApi.listMembers(ctx, p.projectId))
    })
    ipcMain.handle(ch.PROJECT_FLOW_UPSERT_MEMBER, async (_e, p: any) => {
        const ctx = getCtx(p);
        if (!ctx) return {ok: false, error: 'missing ctx'}
        return safeRun(() => projectFlowApi.upsertMember(ctx, p.projectId, p.body))
    })
    ipcMain.handle(ch.PROJECT_FLOW_REMOVE_MEMBER, async (_e, p: any) => {
        const ctx = getCtx(p);
        if (!ctx) return {ok: false, error: 'missing ctx'}
        return safeRun(() => projectFlowApi.removeMember(ctx, p.projectId, p.memberUserId))
    })
    ipcMain.handle(ch.PROJECT_FLOW_SEARCH_EMPLOYEES, async (_e, p: any) => {
        const ctx = getCtx(p);
        if (!ctx) return {ok: false, error: 'missing ctx'}
        return safeRun(() => projectFlowApi.searchEmployees(ctx, p.query ?? {}))
    })
    // 今日活動聚合 — 純本地讀 work-collect,不打後端(匯報編輯器的唯讀參考面板)
    ipcMain.handle(ch.PROJECT_FLOW_TODAY_ACTIVITY, async () => {
        return safeRun(async () => {
            if (!deps.workRecordService) throw new Error('工作採集服務未就緒')
            return aggregateTodayActivity(deps.workRecordService)
        })
    })

    // ── Edges ───────────────────────────────────────────────
    ipcMain.handle(ch.PROJECT_FLOW_CREATE_EDGE, async (_e, p: any) => {
        const ctx = getCtx(p);
        if (!ctx) return {ok: false, error: 'missing ctx'}
        return safeRun(() => projectFlowApi.createEdge(ctx, p.projectId, p.body))
    })
    ipcMain.handle(ch.PROJECT_FLOW_UPDATE_EDGE, async (_e, p: any) => {
        const ctx = getCtx(p);
        if (!ctx) return {ok: false, error: 'missing ctx'}
        return safeRun(() => projectFlowApi.updateEdge(ctx, p.edgeId, p.body))
    })
    ipcMain.handle(ch.PROJECT_FLOW_DELETE_EDGE, async (_e, p: any) => {
        const ctx = getCtx(p);
        if (!ctx) return {ok: false, error: 'missing ctx'}
        return safeRun(() => projectFlowApi.deleteEdge(ctx, p.edgeId))
    })

    // ── Reports ─────────────────────────────────────────────
    ipcMain.handle(ch.PROJECT_FLOW_LIST_REPORTS, async (_e, p: any) => {
        const ctx = getCtx(p);
        if (!ctx) return {ok: false, error: 'missing ctx'}
        return safeRun(() => projectFlowApi.listReports(ctx, p.query ?? {}))
    })
    ipcMain.handle(ch.PROJECT_FLOW_GET_REPORT, async (_e, p: any) => {
        const ctx = getCtx(p);
        if (!ctx) return {ok: false, error: 'missing ctx'}
        return safeRun(() => projectFlowApi.getReport(ctx, p.reportId))
    })
    ipcMain.handle(ch.PROJECT_FLOW_CREATE_REPORT, async (_e, p: any) => {
        const ctx = getCtx(p);
        if (!ctx) return {ok: false, error: 'missing ctx'}
        return safeRun(() => projectFlowApi.createReport(ctx, p.body))
    })
    ipcMain.handle(ch.PROJECT_FLOW_UPDATE_REPORT, async (_e, p: any) => {
        const ctx = getCtx(p);
        if (!ctx) return {ok: false, error: 'missing ctx'}
        return safeRun(() => projectFlowApi.updateReport(ctx, p.reportId, p.body))
    })
    ipcMain.handle(ch.PROJECT_FLOW_SUBMIT_REPORT, async (_e, p: any) => {
        const ctx = getCtx(p);
        if (!ctx) return {ok: false, error: 'missing ctx'}
        return safeRun(() => projectFlowApi.submitReport(ctx, p.reportId))
    })
    ipcMain.handle(ch.PROJECT_FLOW_DELETE_REPORT, async (_e, p: any) => {
        const ctx = getCtx(p);
        if (!ctx) return {ok: false, error: 'missing ctx'}
        return safeRun(() => projectFlowApi.deleteReport(ctx, p.reportId))
    })

    // ── Memos ───────────────────────────────────────────────
    ipcMain.handle(ch.PROJECT_FLOW_LIST_MEMOS, async (_e, p: any) => {
        const ctx = getCtx(p);
        if (!ctx) return {ok: false, error: 'missing ctx'}
        return safeRun(() => projectFlowApi.listMemos(ctx, p.query ?? {}))
    })
    ipcMain.handle(ch.PROJECT_FLOW_CREATE_MEMO, async (_e, p: any) => {
        const ctx = getCtx(p);
        if (!ctx) return {ok: false, error: 'missing ctx'}
        return safeRun(() => projectFlowApi.createMemo(ctx, p.body))
    })
    ipcMain.handle(ch.PROJECT_FLOW_UPDATE_MEMO, async (_e, p: any) => {
        const ctx = getCtx(p);
        if (!ctx) return {ok: false, error: 'missing ctx'}
        return safeRun(() => projectFlowApi.updateMemo(ctx, p.memoId, p.body))
    })
    ipcMain.handle(ch.PROJECT_FLOW_SET_MEMO_STATUS, async (_e, p: any) => {
        const ctx = getCtx(p);
        if (!ctx) return {ok: false, error: 'missing ctx'}
        return safeRun(() => projectFlowApi.setMemoStatus(ctx, p.memoId, p.body))
    })
    ipcMain.handle(ch.PROJECT_FLOW_DELETE_MEMO, async (_e, p: any) => {
        const ctx = getCtx(p);
        if (!ctx) return {ok: false, error: 'missing ctx'}
        return safeRun(() => projectFlowApi.deleteMemo(ctx, p.memoId))
    })

    // ── Feedback ────────────────────────────────────────────
    ipcMain.handle(ch.PROJECT_FLOW_CREATE_FEEDBACK, async (_e, p: any) => {
        const ctx = getCtx(p);
        if (!ctx) return {ok: false, error: 'missing ctx'}
        return safeRun(() => projectFlowApi.createFeedback(ctx, p.body))
    })
    ipcMain.handle(ch.PROJECT_FLOW_LIST_FEEDBACK_BY_TARGET, async (_e, p: any) => {
        const ctx = getCtx(p);
        if (!ctx) return {ok: false, error: 'missing ctx'}
        return safeRun(() => projectFlowApi.listFeedbackByTarget(ctx, {targetType: p.targetType, targetId: p.targetId}))
    })
    ipcMain.handle(ch.PROJECT_FLOW_LIST_MY_UNREAD, async (_e, p: any) => {
        const ctx = getCtx(p);
        if (!ctx) return {ok: false, error: 'missing ctx'}
        return safeRun(() => projectFlowApi.listMyUnread(ctx))
    })
    ipcMain.handle(ch.PROJECT_FLOW_COUNT_MY_UNREAD, async (_e, p: any) => {
        const ctx = getCtx(p);
        if (!ctx) return {ok: false, error: 'missing ctx'}
        return safeRun(() => projectFlowApi.countMyUnread(ctx))
    })
    ipcMain.handle(ch.PROJECT_FLOW_MARK_FEEDBACK_READ, async (_e, p: any) => {
        const ctx = getCtx(p);
        if (!ctx) return {ok: false, error: 'missing ctx'}
        return safeRun(() => projectFlowApi.markFeedbackRead(ctx, p.feedbackId))
    })

    // ── Team ────────────────────────────────────────────────
    ipcMain.handle(ch.PROJECT_FLOW_LIST_SUBORDINATES, async (_e, p: any) => {
        const ctx = getCtx(p);
        if (!ctx) return {ok: false, error: 'missing ctx'}
        return safeRun(() => projectFlowApi.listSubordinates(ctx, p.query ?? {}))
    })
    ipcMain.handle(ch.PROJECT_FLOW_LIST_SUB_REPORTS, async (_e, p: any) => {
        const ctx = getCtx(p);
        if (!ctx) return {ok: false, error: 'missing ctx'}
        return safeRun(() => projectFlowApi.listSubReports(ctx, p.userId, p.query ?? {}))
    })
    ipcMain.handle(ch.PROJECT_FLOW_LIST_SUB_MEMOS, async (_e, p: any) => {
        const ctx = getCtx(p);
        if (!ctx) return {ok: false, error: 'missing ctx'}
        return safeRun(() => projectFlowApi.listSubMemos(ctx, p.userId))
    })

    // ── AI server-side ──────────────────────────────────────
    ipcMain.handle(ch.PROJECT_FLOW_AI_PROJECT_SUMMARY, async (_e, p: any) => {
        const ctx = getCtx(p);
        if (!ctx) return {ok: false, error: 'missing ctx'}
        return safeRun(() => projectFlowApi.aiProjectSummary(ctx, p.body))
    })
    ipcMain.handle(ch.PROJECT_FLOW_AI_TEAM_SUMMARY, async (_e, p: any) => {
        const ctx = getCtx(p);
        if (!ctx) return {ok: false, error: 'missing ctx'}
        return safeRun(() => projectFlowApi.aiTeamSummary(ctx, p.body))
    })
    ipcMain.handle(ch.PROJECT_FLOW_AI_QUOTA, async (_e, p: any) => {
        const ctx = getCtx(p);
        if (!ctx) return {ok: false, error: 'missing ctx'}
        return safeRun(() => projectFlowApi.getQuota(ctx))
    })

    // ── AI 本地(寫作建議 / 備忘建議) ───────────────────────
    // 走本地 LlmClient(用戶自配 provider),不消耗後端配額。
    // 設計原則:AI 是「教練」不是「代筆」— 不產出可直接提交的內容。

    ipcMain.handle(ch.PROJECT_FLOW_AI_MEMO_SUGGEST, async (_e, p: any) => {
        return safeRun(() => generateMemoSuggestions(deps, p?.body ?? {}))
    })

    ipcMain.handle(ch.PROJECT_FLOW_AI_REPORT_ADVICE, async (_e, p: any) => {
        return safeRun(() => generateReportAdvice(deps, p?.body ?? {}))
    })
}

// ─── 今日活動聚合(結構化,匯報編輯器參考面板 + AI 建議共用) ──

interface TodayActivityCategory {
    category: string
    minutes: number
    apps: string[]
}

/**
 * 取今日 00:00 到此刻的 work-collect 紀錄,聚合成「類別 → 估算分鐘 + 主要應用」。
 * 只回聚合,不回每筆原始紀錄(prompt 長度 + 隱私)。每筆 ≈ 5 分鐘採集間隔。
 */
function aggregateTodayActivity(workRecordService: WorkRecordService): TodayActivityCategory[] {
    const now = new Date()
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
    const records = workRecordService.listByRange(startOfDay, Date.now(), false)

    const byCategory = new Map<string, { apps: Set<string>; count: number }>()
    for (const r of records) {
        const cat = r.category ?? 'unknown'
        const entry = byCategory.get(cat) ?? {apps: new Set<string>(), count: 0}
        entry.count++
        if (r.activeApp) entry.apps.add(r.activeApp)
        byCategory.set(cat, entry)
    }

    return Array.from(byCategory.entries())
        .sort((a, b) => b[1].count - a[1].count)
        .map(([category, info]) => ({
            category,
            minutes: info.count * 5,
            apps: Array.from(info.apps).slice(0, 5),
        }))
}

/** 聚合結果 → prompt 用文字 */
function activityText(categories: TodayActivityCategory[]): string {
    if (!categories.length) return '(今日尚無工作紀錄)'
    return categories
        .map((c) => `- ${c.category}: 約 ${c.minutes} 分鐘 (主要應用: ${c.apps.slice(0, 3).join(', ')})`)
        .join('\n')
}

// ─── AI 備忘建議:項目進度 + 現有待辦驅動(不看原始活動記錄) ──

/** renderer 傳來的上下文:我的節點(含截止日/狀態)+ 現有 pending 備忘 */
interface MemoSuggestInput {
    nodes?: { projectName: string; title: string; status: string; deadline?: number | null; priority?: number }[]
    memos?: { title: string; priority: number; dueDate?: number | null }[]
}

async function generateMemoSuggestions(deps: ProjectFlowHandlerDeps, input: MemoSuggestInput): Promise<{
    suggestions: object[]
}> {
    if (!deps.llmClient) throw new Error('LLM provider 尚未配置(請先到設定頁設定)')

    const today = new Date().toISOString().slice(0, 10)
    const fmtDate = (ms?: number | null) => (ms ? new Date(ms).toISOString().slice(0, 10) : '無')

    // 節點:只給未完成的;備忘:只給 pending(renderer 端已過濾,這裡再保險截斷)
    const nodeLines = (input.nodes ?? []).slice(0, 30)
        .map((n) => `- [${n.status}] ${n.projectName} / ${n.title}(截止: ${fmtDate(n.deadline)})`)
        .join('\n') || '(目前沒有指派給我的節點)'
    const memoLines = (input.memos ?? []).slice(0, 30)
        .map((m) => `- [優先級${m.priority}] ${m.title}(到期: ${fmtDate(m.dueDate)})`)
        .join('\n') || '(目前沒有進行中備忘)'

    const result = await deps.llmClient.complete({
        responseFormat: 'json_object',
        temperature: 0.4,
        messages: [
            {
                role: 'system',
                content:
                    '你是工作助理。根據使用者的項目節點進度與現有待辦,建議值得新增的備忘錄。' +
                    '優先關注:即將到期或已逾期的節點、blocked 狀態的節點、高優先級但沒有跟進動作的待辦。' +
                    '不要重複已存在的備忘。回 JSON。',
            },
            {
                role: 'user',
                content:
                    `今天是 ${today}。\n\n我負責的項目節點:\n${nodeLines}\n\n現有進行中備忘:\n${memoLines}\n\n` +
                    `請建議最多 3 條新備忘(沒有值得提醒的就回空陣列)。\n` +
                    `回 JSON:{"suggestions":[{"title":"短標題","description":"具體說明","priority":1,"reasoning":"為什麼建議(關聯哪個節點/截止日)"}]}\n` +
                    `priority:0=低 1=中 2=高(逾期/即將到期給 2)。`,
            },
        ],
    })
    return safeParseJson<{ suggestions: object[] }>(result.content, 'suggestions')
}

// ─── AI 寫作教練:看草稿 + 今日數據,給建議不代寫 ─────────────

/** renderer 傳來的草稿(三區的現有內容) */
interface ReportAdviceInput {
    work?: string[]
    issue?: string[]
    plan?: string[]
}

async function generateReportAdvice(deps: ProjectFlowHandlerDeps, input: ReportAdviceInput): Promise<object> {
    if (!deps.llmClient) throw new Error('LLM provider 尚未配置(請先到設定頁設定)')
    if (!deps.workRecordService) throw new Error('工作採集服務未就緒')

    const activity = activityText(aggregateTodayActivity(deps.workRecordService))
    const sec = (label: string, items?: string[]) =>
        `${label}:\n${(items ?? []).filter((s) => s.trim()).map((s) => `- ${s}`).join('\n') || '(還沒寫)'}`

    const result = await deps.llmClient.complete({
        responseFormat: 'json_object',
        temperature: 0.5,
        messages: [
            {
                role: 'system',
                content:
                    '你是寫作教練,幫使用者把工作匯報寫得更好。' +
                    '你「只給建議,絕不代寫整段內容」:指出可以寫的方向、針對已寫內容給潤色建議、提醒可能遺漏的點。' +
                    '建議要具體可操作(例如「補上數字/結果」「拆成兩條」),不要空泛。回 JSON。',
            },
            {
                role: 'user',
                content:
                    `我的今日活動數據(僅供參考,不要直接抄進匯報):\n${activity}\n\n` +
                    `我目前的草稿:\n${sec('【今日工作】', input.work)}\n\n${sec('【問題與困難】', input.issue)}\n\n${sec('【明日計畫】', input.plan)}\n\n` +
                    `回 JSON:{\n` +
                    `  "ideas": ["可以寫什麼方向(結合活動數據提示我今天做過但沒寫的)"],\n` +
                    `  "polish": [{"original":"我寫的某條原文","suggestion":"怎麼改更好(更具體/有結果/有數據)"}],\n` +
                    `  "missing": ["可能遺漏的點(例如風險、需要的支援、依賴他人的事項)"]\n` +
                    `}\n每個陣列最多 4 條;草稿是空的就 polish 給空陣列,把重點放 ideas。`,
            },
        ],
    })
    return safeParseJson<object>(result.content, 'advice')
}

/** LLM 回的 content 可能包 markdown 圍欄,先剝再 parse;parse 失敗給清楚錯誤訊息 */
function safeParseJson<T>(raw: string, label: string): T {
    const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim()
    try {
        return JSON.parse(trimmed) as T
    } catch (err) {
        throw new Error(`LLM ${label} 回應非合法 JSON: ${(err as Error).message}`)
    }
}
