/**
 * ProjectFlow HTTP client 的純工具 — URL 拼接 + undici 錯誤歸類。
 * 從 api-client.ts 抽出,方便單元測試(api-client 本體依賴 fetch / logger,難純測)。
 */

/**
 * undici(Node fetch)把所有網路層失敗統一包成「fetch failed」,真因藏在 err.cause。
 * 伺服器環境最常見的是 keep-alive 殭屍連線:GET 頻繁所以連線常熱,
 * 偶發的 POST 拿到池子裡「對端已關」的 socket → 寫入即 ECONNRESET。
 * 這類錯誤換條新連線重打一次幾乎必成,所以歸類為「可重試」。
 */
export const RETRYABLE_CAUSES = new Set(['ECONNRESET', 'EPIPE', 'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT'])

/** 從 fetch 異常裡挖出底層 cause 描述(code 優先);非網路錯誤回 null */
export function fetchCause(err: unknown): { code: string; text: string } | null {
    const cause = (err as { cause?: { code?: string; message?: string } })?.cause
    if (!cause) return null
    return {code: cause.code ?? '', text: cause.code ?? cause.message ?? 'unknown'}
}

/** 這個 cause 是否值得換連線重試一次 */
export function isRetryableCause(cause: { code: string } | null): boolean {
    return !!cause && RETRYABLE_CAUSES.has(cause.code)
}

/** 拼 base + path,避免雙斜線 / 缺斜線 */
export function joinUrl(base: string, path: string): string {
    const b = base.endsWith('/') ? base.slice(0, -1) : base
    const p = path.startsWith('/') ? path : '/' + path
    return b + p
}

/** 把 userId 加到 query string(自動判斷 ? / & 分隔;空 userId 不加) */
export function appendUserId(url: string, userId: string): string {
    if (!userId) return url
    const sep = url.includes('?') ? '&' : '?'
    return `${url}${sep}userId=${encodeURIComponent(userId)}`
}

/** 把 params 物件序列化成 query string(濾掉 null/空),回不含 ? 的片段 */
export function buildQuery(params: Record<string, unknown>): string {
    return Object.entries(params)
        .filter(([, v]) => v != null && v !== '')
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join('&')
}
