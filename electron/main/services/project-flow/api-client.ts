/**
 * ProjectFlow HTTP API client(主進程版,走 fetch)。
 *
 * 為什麼放 main 不放 renderer:
 *   - renderer 端有 axios 但 fetch 也行,本來可以 renderer 直接打。
 *   - 放 main 跟 work-collect/sync-service 一致(同套 token / baseUrl 注入機制),
 *     未來想做「請求快取」「離線降級」也是在 main 統一做。
 *   - renderer 透過 IPC 呼叫,API client 邏輯純粹在 main,renderer 不重複實作 retry / timeout。
 *
 * Token / baseUrl 由 caller 傳進來(從 renderer authStore 拿,跟 notification-client / sync-service 同套)。
 */

import {logger} from '../../utils/logger'

const TAG = 'project-flow.api'

const REQUEST_TIMEOUT_MS = 15_000

/**
 * AI 端點專用 timeout — 後端要打 Qwen LLM,常見 20~60s,15s 必超時
 * (renderer 會看到「This operation was aborted」)。對齊後端 Qwen:TimeoutSeconds 上限再留 buffer。
 */
const AI_REQUEST_TIMEOUT_MS = 120_000

/** 後端統一 envelope:{ code, message, data } */
interface Envelope<T> {
    code: number
    message?: string
    data?: T
}

/**
 * 呼叫後端必備的上下文。
 *
 * 後端 ProjectFlowController 已加 [AllowAnonymous] — JWT 不校驗,身分靠每個請求 query 帶 userId。
 * 為什麼還留 token:其他 controller (work-collect / repair) 仍走 JWT;若 baseUrl 共用,
 *   保留 Bearer header 對其他 controller 也可順帶生效,額外成本接近 0。
 */
export interface ProjectFlowApiContext {
    baseUrl: string
    /** 工號 — 對齊後端 [FromQuery] string userId,所有 endpoint 自動帶上 */
    userId: string
    /** 預留;ProjectFlow 端點不校驗,但 Authorization header 仍會帶上(無害) */
    token?: string
}

/** 對外暴露給 IPC handler 的函式;每個 method 接 (ctx, payload) 回 data */
export const projectFlowApi = {
    listProjects(ctx: ProjectFlowApiContext, params: { keyword?: string; pageIndex?: number; pageSize?: number }) {
        return get(ctx, '/api/projectflow/projects', params)
    },
    getProject(ctx: ProjectFlowApiContext, projectId: number) {
        return get(ctx, `/api/projectflow/projects/${projectId}`, {})
    },
    createProject(ctx: ProjectFlowApiContext, body: unknown) {
        return post(ctx, '/api/projectflow/projects', body)
    },
    updateProject(ctx: ProjectFlowApiContext, projectId: number, body: unknown) {
        return req(ctx, 'PUT', `/api/projectflow/projects/${projectId}`, body)
    },
    deleteProject(ctx: ProjectFlowApiContext, projectId: number) {
        return req(ctx, 'DELETE', `/api/projectflow/projects/${projectId}`, null)
    },

    createNode(ctx: ProjectFlowApiContext, projectId: number, body: unknown) {
        return post(ctx, `/api/projectflow/projects/${projectId}/nodes`, body)
    },
    updateNode(ctx: ProjectFlowApiContext, nodeId: number, body: unknown) {
        return req(ctx, 'PUT', `/api/projectflow/nodes/${nodeId}`, body)
    },
    deleteNode(ctx: ProjectFlowApiContext, nodeId: number) {
        return req(ctx, 'DELETE', `/api/projectflow/nodes/${nodeId}`, null)
    },
    patchNodeStatus(ctx: ProjectFlowApiContext, nodeId: number, body: unknown) {
        return req(ctx, 'PATCH', `/api/projectflow/nodes/${nodeId}/status`, body)
    },
    listNodeReportItems(ctx: ProjectFlowApiContext, nodeId: number) {
        return get(ctx, `/api/projectflow/nodes/${nodeId}/report-items`, {})
    },
    getNodeProgress(ctx: ProjectFlowApiContext, nodeId: number) {
        return get(ctx, `/api/projectflow/nodes/${nodeId}/progress`, {})
    },

    /** 跨項目「我的節點」— 個人時間線 / 備忘 AI 進度輸入 */
    listMyNodes(ctx: ProjectFlowApiContext) {
        return get(ctx, '/api/projectflow/my-nodes', {})
    },

    // ── Members(成員制權限) ──
    listMembers(ctx: ProjectFlowApiContext, projectId: number) {
        return get(ctx, `/api/projectflow/projects/${projectId}/members`, {})
    },
    upsertMember(ctx: ProjectFlowApiContext, projectId: number, body: unknown) {
        return post(ctx, `/api/projectflow/projects/${projectId}/members`, body)
    },
    removeMember(ctx: ProjectFlowApiContext, projectId: number, memberUserId: string) {
        return req(ctx, 'DELETE', `/api/projectflow/projects/${projectId}/members/${encodeURIComponent(memberUserId)}`, null)
    },

    /**
     * 員工模糊搜尋 — 複用後端既有 /api/employee/getEmployees(工號/姓名/電話 OR 匹配)。
     * 不屬於 projectflow controller,但同一個 baseUrl,放這裡讓負責人選擇彈窗共用。
     */
    searchEmployees(ctx: ProjectFlowApiContext, params: { keyword?: string; pageIndex?: number; pageSize?: number }) {
        return get(ctx, '/api/employee/getEmployees', {
            EmpNo: params.keyword,
            PageIndex: params.pageIndex ?? 1,
            PageSize: params.pageSize ?? 20,
        })
    },

    createEdge(ctx: ProjectFlowApiContext, projectId: number, body: unknown) {
        return post(ctx, `/api/projectflow/projects/${projectId}/edges`, body)
    },
    updateEdge(ctx: ProjectFlowApiContext, edgeId: number, body: unknown) {
        return req(ctx, 'PUT', `/api/projectflow/edges/${edgeId}`, body)
    },
    deleteEdge(ctx: ProjectFlowApiContext, edgeId: number) {
        return req(ctx, 'DELETE', `/api/projectflow/edges/${edgeId}`, null)
    },

    // Reports
    listReports(ctx: ProjectFlowApiContext, params: unknown) {
        return get(ctx, '/api/projectflow/reports', params as Record<string, unknown>)
    },
    getReport(ctx: ProjectFlowApiContext, id: number) {
        return get(ctx, `/api/projectflow/reports/${id}`, {})
    },
    createReport(ctx: ProjectFlowApiContext, body: unknown) {
        return post(ctx, '/api/projectflow/reports', body)
    },
    updateReport(ctx: ProjectFlowApiContext, id: number, body: unknown) {
        return req(ctx, 'PUT', `/api/projectflow/reports/${id}`, body)
    },
    submitReport(ctx: ProjectFlowApiContext, id: number) {
        return post(ctx, `/api/projectflow/reports/${id}/submit`, {})
    },
    deleteReport(ctx: ProjectFlowApiContext, id: number) {
        return req(ctx, 'DELETE', `/api/projectflow/reports/${id}`, null)
    },

    // Memos
    listMemos(ctx: ProjectFlowApiContext, params: unknown) {
        return get(ctx, '/api/projectflow/memos', params as Record<string, unknown>)
    },
    createMemo(ctx: ProjectFlowApiContext, body: unknown) {
        return post(ctx, '/api/projectflow/memos', body)
    },
    updateMemo(ctx: ProjectFlowApiContext, id: number, body: unknown) {
        return req(ctx, 'PUT', `/api/projectflow/memos/${id}`, body)
    },
    setMemoStatus(ctx: ProjectFlowApiContext, id: number, body: unknown) {
        return req(ctx, 'PATCH', `/api/projectflow/memos/${id}/status`, body)
    },
    deleteMemo(ctx: ProjectFlowApiContext, id: number) {
        return req(ctx, 'DELETE', `/api/projectflow/memos/${id}`, null)
    },

    // Feedback
    createFeedback(ctx: ProjectFlowApiContext, body: unknown) {
        return post(ctx, '/api/projectflow/feedback', body)
    },
    listFeedbackByTarget(ctx: ProjectFlowApiContext, params: { targetType: string; targetId: number }) {
        return get(ctx, '/api/projectflow/feedback', params)
    },
    listMyUnread(ctx: ProjectFlowApiContext) {
        return get(ctx, '/api/projectflow/my-feedback', {unread: 'true'})
    },
    countMyUnread(ctx: ProjectFlowApiContext) {
        return get(ctx, '/api/projectflow/my-feedback/count', {})
    },
    markFeedbackRead(ctx: ProjectFlowApiContext, id: number) {
        return req(ctx, 'PATCH', `/api/projectflow/feedback/${id}/read`, null)
    },

    // Team
    listSubordinates(ctx: ProjectFlowApiContext, params: {
        keyword?: string;
        pageIndex?: number;
        pageSize?: number
    } = {}) {
        return get(ctx, '/api/projectflow/team/subordinates', params)
    },
    listSubReports(ctx: ProjectFlowApiContext, userId: string, params: unknown) {
        return get(ctx, `/api/projectflow/team/subordinates/${encodeURIComponent(userId)}/reports`, params as Record<string, unknown>)
    },
    listSubMemos(ctx: ProjectFlowApiContext, userId: string) {
        return get(ctx, `/api/projectflow/team/subordinates/${encodeURIComponent(userId)}/memos`, {})
    },

    // AI (server-side summary) — 長 timeout,LLM 生成慢
    aiProjectSummary(ctx: ProjectFlowApiContext, body: unknown) {
        return req(ctx, 'POST', '/api/projectflow/ai/project-summary', body, AI_REQUEST_TIMEOUT_MS)
    },
    aiTeamSummary(ctx: ProjectFlowApiContext, body: unknown) {
        return req(ctx, 'POST', '/api/projectflow/ai/team-summary', body, AI_REQUEST_TIMEOUT_MS)
    },
    getQuota(ctx: ProjectFlowApiContext) {
        return get(ctx, '/api/projectflow/ai/quota', {})
    },
    consumeQuota(ctx: ProjectFlowApiContext, body: unknown) {
        return post(ctx, '/api/projectflow/ai/quota/consume', body)
    },
}

// ─── 內部 HTTP helper ───────────────────────────────────────

async function req<T>(
    ctx: ProjectFlowApiContext,
    method: string,
    path: string,
    body: unknown,
    timeoutMs: number = REQUEST_TIMEOUT_MS,
): Promise<T> {
    // 自動注入 userId 到 query — 後端 [AllowAnonymous] + [FromQuery] string userId
    const url = appendUserId(joinUrl(ctx.baseUrl, path), ctx.userId)
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    try {
        const headers: Record<string, string> = {'Content-Type': 'application/json'}
        if (ctx.token) headers.Authorization = `Bearer ${ctx.token}`
        const res = await fetch(url, {
            method,
            headers,
            body: body == null ? undefined : JSON.stringify(body),
            signal: ctrl.signal,
        })
        if (!res.ok) {
            throw new Error(`HTTP ${res.status} ${res.statusText} ${path}`)
        }
        const env = await res.json() as Envelope<T>
        if (env.code !== 200) {
            throw new Error(env.message || `code=${env.code}`)
        }
        return env.data as T
    } catch (err) {
        // AbortController 砍掉的 fetch 訊息是「This operation was aborted」,對使用者沒資訊量 → 翻成超時
        const e = err as Error
        const friendly = e.name === 'AbortError' || /abort/i.test(e.message)
            ? new Error(`請求超時(${Math.round(timeoutMs / 1000)}s):${path}`)
            : e
        logger.warn(`${method} ${path} 失敗: ${friendly.message}`, TAG)
        throw friendly
    } finally {
        clearTimeout(timer)
    }
}

function get<T>(ctx: ProjectFlowApiContext, path: string, params: Record<string, unknown>): Promise<T> {
    const q = Object.entries(params)
        .filter(([, v]) => v != null && v !== '')
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join('&')
    const full = q ? `${path}?${q}` : path
    return req<T>(ctx, 'GET', full, null)
}

function post<T>(ctx: ProjectFlowApiContext, path: string, body: unknown): Promise<T> {
    return req<T>(ctx, 'POST', path, body)
}

function joinUrl(base: string, path: string): string {
    const b = base.endsWith('/') ? base.slice(0, -1) : base
    const p = path.startsWith('/') ? path : '/' + path
    return b + p
}

/** 把 userId 加到 query string(自動判斷 ? / & 分隔) */
function appendUserId(url: string, userId: string): string {
    if (!userId) return url
    const sep = url.includes('?') ? '&' : '?'
    return `${url}${sep}userId=${encodeURIComponent(userId)}`
}
