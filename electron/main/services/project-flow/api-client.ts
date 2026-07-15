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
import {appendUserId, buildQuery, fetchCause, isRetryableCause, joinUrl} from './http-utils'

const TAG = 'project-flow.api'

const REQUEST_TIMEOUT_MS = 15_000

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
    /** 跨項目「我的節點」— 備忘 AI 進度輸入 */
    listMyNodes(ctx: ProjectFlowApiContext) {
        return get(ctx, '/api/projectflow/my-nodes', {})
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
}

// ─── 內部 HTTP helper(URL 拼接 / 錯誤歸類純函數已抽到 http-utils.ts)───

async function req<T>(
    ctx: ProjectFlowApiContext,
    method: string,
    path: string,
    body: unknown,
    timeoutMs: number = REQUEST_TIMEOUT_MS,
): Promise<T> {
    // 自動注入 userId 到 query — 後端 [AllowAnonymous] + [FromQuery] string userId
    const url = appendUserId(joinUrl(ctx.baseUrl, path), ctx.userId)

    // 第一次失敗且是「連線層可重試」錯誤 → 換新連線立刻重打一次
    for (let attempt = 0; ; attempt++) {
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
            const e = err as Error
            const cause = fetchCause(e)

            // 殭屍 keep-alive 連線:重試一次(新請求會建新 socket)
            if (attempt === 0 && cause && isRetryableCause(cause)) {
                logger.warn(`${method} ${path} 連線層失敗(${cause.text}),重試一次`, TAG)
                clearTimeout(timer)
                continue
            }

            // AbortController 砍掉的訊息是「This operation was aborted」→ 翻成超時;
            // 「fetch failed」附上 cause,日誌才查得到真因(ECONNRESET / EAI_AGAIN / ...)
            let friendly = e
            if (e.name === 'AbortError' || /abort/i.test(e.message)) {
                friendly = new Error(`請求超時(${Math.round(timeoutMs / 1000)}s):${path}`)
            } else if (cause) {
                friendly = new Error(`網路錯誤(${cause.text}):${path}`)
            }
            logger.warn(`${method} ${path} 失敗: ${friendly.message}`, TAG)
            throw friendly
        } finally {
            clearTimeout(timer)
        }
    }
}

function get<T>(ctx: ProjectFlowApiContext, path: string, params: Record<string, unknown>): Promise<T> {
    const q = buildQuery(params)
    const full = q ? `${path}?${q}` : path
    return req<T>(ctx, 'GET', full, null)
}

function post<T>(ctx: ProjectFlowApiContext, path: string, body: unknown): Promise<T> {
    return req<T>(ctx, 'POST', path, body)
}
