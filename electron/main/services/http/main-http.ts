/**
 * 主進程統一 HTTP 發送核心 —— project-flow / idea-capture 等 main-process API client 共用。
 *
 * 之前 project-flow 與 idea-capture 各自複製了一份幾乎一樣的「fetch + 注入 Authorization +
 * 超時中止 + 連線層(殭屍 keep-alive)重試一次 + 拆後端 {code,message,data} envelope」循環。
 * 收斂到這裡:各 feature client 只寫「端點 → init(JSON / multipart)」的薄映射,核心一處維護。
 *
 * 純 URL / 錯誤歸類工具在 ./http-utils。
 */

import {logger} from '../../utils/logger'
import {fetchCause, isRetryableCause, joinUrl} from './http-utils'

export const DEFAULT_TIMEOUT_MS = 15_000

/**
 * 呼叫後端必備的上下文。
 * baseUrl + 預留 token(Bearer);後端多為 [AllowAnonymous],身分靠 query 的 userId/userName
 * (各 client 自己拼),但 Authorization 仍帶上,對走 JWT 的 controller 也順帶生效(無害)。
 */
export interface MainHttpContext {
    baseUrl: string
    token?: string
}

/** 後端統一 envelope:{ code, message, data } */
interface Envelope<T> {
    code: number
    message?: string
    data?: T
}

/**
 * 共用發送:注入 Authorization、超時、連線層重試一次、拆 envelope。
 *
 * @param init  由 caller 給(JSON body 或 multipart FormData 皆可);Authorization 由本函式補。
 * @param tag   日誌前綴(各 client 傳自己的 TAG)
 */
export async function sendMain<T>(
    ctx: MainHttpContext,
    method: string,
    path: string,
    init: RequestInit,
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
    tag = 'main-http',
): Promise<T> {
    const url = joinUrl(ctx.baseUrl, path)

    // 第一次失敗且是「連線層可重試」錯誤 → 換新連線立刻重打一次
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

            // 殭屍 keep-alive 連線:重試一次(新請求會建新 socket)
            if (attempt === 0 && cause && isRetryableCause(cause)) {
                logger.warn(`${method} ${path} 連線層失敗(${cause.text}),重試一次`, tag)
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
            logger.warn(`${method} ${path} 失敗: ${friendly.message}`, tag)
            throw friendly
        } finally {
            clearTimeout(timer)
        }
    }
}
