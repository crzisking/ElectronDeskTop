/**
 * 靈感速記後端 API client(主進程,走 fetch)。
 *
 * 對齊 project-flow / work-collect 的 main-process 慣例:token/baseUrl/userName 由 caller
 * 傳入(從 authContext 拿);後端 IdeaCaptureController 是 [AllowAnonymous] + 顯式 userName。
 * create 走 multipart(meta JSON + 附件);其餘 JSON。附件檔在 MinIO,list/detail 回 URL,
 * 由本層的 fetchAttachment 代拉成 dataURL 給 renderer(避開 renderer CSP)。
 */

import {readFile} from 'fs/promises'
import {logger} from '../utils/logger'
import {buildQuery, fetchCause, isRetryableCause, joinUrl} from '../services/project-flow/http-utils'
import type {
    IdeaAiResult,
    IdeaCreateMeta,
    IdeaDetail,
    IdeaDraftAttachment,
    IdeaListItem,
    IdeaListQuery,
    IdeaPatch,
    IdeaRefineStatus,
} from '../../shared/types/idea-capture.types'
import type {PagedResult} from './types'

const TAG = 'idea-capture.api'
const TIMEOUT_MS = 15_000
const UPLOAD_TIMEOUT_MS = 60_000 // create 帶附件上傳,放寬

export interface IdeaApiContext {
    baseUrl: string
    /** 工號;後端 [AllowAnonymous] 靠這個認身分 */
    userName: string
    token?: string
}

interface Envelope<T> {
    code: number
    message?: string
    data?: T
}

export const ideaApi = {
    /** 建立(multipart)。meta.userName 由本層補上 ctx.userName。回 {clientId} */
    async create(ctx: IdeaApiContext, meta: IdeaCreateMeta, files: IdeaDraftAttachment[]): Promise<{
        clientId: string;
        id: number
    }> {
        const form = new FormData()
        form.append('meta', JSON.stringify({...meta, userName: ctx.userName}))
        for (const f of files) {
            const bytes = await toBytes(f)
            if (!bytes) continue
            form.append('attachments', new Blob([bytes], {type: f.contentType || 'application/octet-stream'}), f.fileName)
        }
        return reqRaw<{ clientId: string; id: number }>(ctx, 'POST', '/api/IdeaCapture/create', form, UPLOAD_TIMEOUT_MS)
    },

    listMy(ctx: IdeaApiContext, query: IdeaListQuery): Promise<PagedResult<IdeaListItem[]>> {
        return get(ctx, '/api/IdeaCapture/my', query as Record<string, unknown>)
    },

    listDept(ctx: IdeaApiContext, query: IdeaListQuery): Promise<PagedResult<IdeaListItem[]>> {
        return get(ctx, '/api/IdeaCapture/dept', query as Record<string, unknown>)
    },

    detail(ctx: IdeaApiContext, clientId: string): Promise<IdeaDetail> {
        return get(ctx, `/api/IdeaCapture/detail/${encodeURIComponent(clientId)}`, {})
    },

    patch(ctx: IdeaApiContext, clientId: string, patch: IdeaPatch): Promise<boolean> {
        return reqJson(ctx, 'PATCH', `/api/IdeaCapture/${encodeURIComponent(clientId)}`, {
            ...patch,
            userName: ctx.userName
        })
    },

    applyAi(ctx: IdeaApiContext, clientId: string, ai: IdeaAiResult, refineStatus: IdeaRefineStatus): Promise<boolean> {
        return reqJson(ctx, 'PATCH', `/api/IdeaCapture/${encodeURIComponent(clientId)}/ai`, {
            userName: ctx.userName,
            title: ai.title,
            polishedText: ai.polishedText,
            actionItems: ai.actionItems,
            aiQuestions: ai.aiQuestions,
            tags: ai.tags,
            refineStatus,
        })
    },

    delete(ctx: IdeaApiContext, clientId: string): Promise<boolean> {
        return reqJson(ctx, 'DELETE', appendUserId2(`/api/IdeaCapture/${encodeURIComponent(clientId)}`, ctx.userName), null)
    },

    /** 拉附件(MinIO URL)→ dataURL(base64);renderer 直接塞 img src */
    async fetchAttachment(url: string): Promise<string> {
        const ctrl = new AbortController()
        const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
        try {
            const res = await fetch(url, {signal: ctrl.signal})
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
            const type = res.headers.get('content-type') || 'application/octet-stream'
            const buf = Buffer.from(await res.arrayBuffer())
            return `data:${type};base64,${buf.toString('base64')}`
        } finally {
            clearTimeout(timer)
        }
    },
}

// ─── 內部 HTTP ────────────────────────────────────────────────

/** userName 進 query(GET / DELETE) */
function appendUserId2(path: string, userName: string): string {
    const sep = path.includes('?') ? '&' : '?'
    return userName ? `${path}${sep}userName=${encodeURIComponent(userName)}` : path
}

function get<T>(ctx: IdeaApiContext, path: string, params: Record<string, unknown>): Promise<T> {
    const q = buildQuery({...params, userName: ctx.userName})
    return reqJson<T>(ctx, 'GET', q ? `${path}?${q}` : path, null)
}

/** JSON body 請求 */
function reqJson<T>(ctx: IdeaApiContext, method: string, path: string, body: unknown, timeoutMs = TIMEOUT_MS): Promise<T> {
    const init: RequestInit = {method}
    if (body != null) {
        init.headers = {'Content-Type': 'application/json'}
        init.body = JSON.stringify(body)
    }
    return send<T>(ctx, method, path, init, timeoutMs)
}

/** 原始 body(multipart FormData)請求 */
function reqRaw<T>(ctx: IdeaApiContext, method: string, path: string, body: FormData, timeoutMs = TIMEOUT_MS): Promise<T> {
    return send<T>(ctx, method, path, {method, body}, timeoutMs)
}

/** 共用發送:注入 Authorization、超時、連線層重試一次、拆後端 envelope */
async function send<T>(ctx: IdeaApiContext, method: string, path: string, init: RequestInit, timeoutMs: number): Promise<T> {
    const url = joinUrl(ctx.baseUrl, path)
    for (let attempt = 0; ; attempt++) {
        const ctrl = new AbortController()
        const timer = setTimeout(() => ctrl.abort(), timeoutMs)
        try {
            const headers = new Headers(init.headers)
            if (ctx.token) headers.set('Authorization', `Bearer ${ctx.token}`)
            const res = await fetch(url, {...init, headers, signal: ctrl.signal})
            if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} ${path}`)
            const env = (await res.json()) as Envelope<T>
            if (env.code !== 200) throw new Error(env.message || `code=${env.code}`)
            return env.data as T
        } catch (err) {
            const e = err as Error
            const cause = fetchCause(e)
            if (attempt === 0 && cause && isRetryableCause(cause)) {
                logger.warn(`${method} ${path} 連線層失敗(${cause.text}),重試一次`, TAG)
                clearTimeout(timer)
                continue
            }
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

/** 附件轉 bytes:base64(貼圖)或讀本機檔(選檔) */
async function toBytes(f: IdeaDraftAttachment): Promise<Uint8Array | null> {
    try {
        if (f.base64) return new Uint8Array(Buffer.from(f.base64, 'base64'))
        if (f.path) return new Uint8Array(await readFile(f.path))
    } catch (err) {
        logger.warn(`附件讀取失敗(${f.fileName}):${(err as Error).message}`, TAG)
    }
    return null
}
