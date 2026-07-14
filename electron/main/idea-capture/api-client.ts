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
import {fetchCause, isRetryableCause, joinUrl} from '../services/project-flow/http-utils'
import type {IdeaCreateMeta, IdeaDraftAttachment, IdeaRefineStatus,} from '../../shared/types/idea-capture.types'

const TAG = 'idea-capture.api'
const TIMEOUT_MS = 15_000
const UPLOAD_TIMEOUT_MS = 60_000 // create 帶附件上傳,放寬
const REFINE_TIMEOUT_MS = 100_000 // AI 完善在後端同步跑 Qwen(後端 90s),留 buffer

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
            // 複製進一個獨立 ArrayBuffer 再給 Blob:Uint8Array<ArrayBufferLike> 不能直接當 BlobPart
            // (型別上底層可能是 SharedArrayBuffer),且避免 Buffer 池化的 byteOffset 帶進雜資料。
            const ab = new ArrayBuffer(bytes.byteLength)
            new Uint8Array(ab).set(bytes)
            form.append('attachments', new Blob([ab], {type: f.contentType || 'application/octet-stream'}), f.fileName)
        }
        return reqRaw<{ clientId: string; id: number }>(ctx, 'POST', '/api/IdeaCapture/create', form, UPLOAD_TIMEOUT_MS)
    },

    /** 觸發後端 AI 完善(後端跑 Qwen,同步等結果)。回最終 refineStatus。 */
    async refine(ctx: IdeaApiContext, clientId: string): Promise<IdeaRefineStatus> {
        const r = await reqJson<{ refineStatus: IdeaRefineStatus }>(
            ctx, 'POST',
            appendUserId2(`/api/IdeaCapture/${encodeURIComponent(clientId)}/refine`, ctx.userName),
            null, REFINE_TIMEOUT_MS,
        )
        return r.refineStatus
    },
}

// ─── 內部 HTTP ────────────────────────────────────────────────

/** userName 進 query */
function appendUserId2(path: string, userName: string): string {
    const sep = path.includes('?') ? '&' : '?'
    return userName ? `${path}${sep}userName=${encodeURIComponent(userName)}` : path
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
