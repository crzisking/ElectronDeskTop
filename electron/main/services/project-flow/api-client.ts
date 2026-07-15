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

import {appendUserId, buildQuery} from '../http/http-utils'
import {sendMain} from '../http/main-http'

const TAG = 'project-flow.api'

const REQUEST_TIMEOUT_MS = 15_000

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
}

// ─── 內部 HTTP helper —— 薄薄一層:拼 userId query + 建 JSON init,核心走 sendMain ───

function req<T>(
    ctx: ProjectFlowApiContext,
    method: string,
    path: string,
    body: unknown,
    timeoutMs: number = REQUEST_TIMEOUT_MS,
): Promise<T> {
    // 自動注入 userId 到 query — 後端 [AllowAnonymous] + [FromQuery] string userId
    const p = appendUserId(path, ctx.userId)
    const init: RequestInit = {
        method,
        headers: {'Content-Type': 'application/json'},
        body: body == null ? undefined : JSON.stringify(body),
    }
    return sendMain<T>(ctx, method, p, init, timeoutMs, TAG)
}

function get<T>(ctx: ProjectFlowApiContext, path: string, params: Record<string, unknown>): Promise<T> {
    const q = buildQuery(params)
    const full = q ? `${path}?${q}` : path
    return req<T>(ctx, 'GET', full, null)
}

function post<T>(ctx: ProjectFlowApiContext, path: string, body: unknown): Promise<T> {
    return req<T>(ctx, 'POST', path, body)
}
