/**
 * 主進程身分上下文(全局單例)。
 *
 * 用途:子視窗(Memos / LogViewer 等)沒法直接讀主窗 renderer 的 Pinia authStore,
 *      但 ProjectFlow 等後端端點需要 userId + baseUrl。主進程持一份,登入後由
 *      主窗推進來(AUTH_SET_CONTEXT),任何 IPC handler 可從這拿。
 *
 * 為什麼放 main 不放 renderer:
 *   - 主窗 + 子窗 + LogViewer 三個 renderer 各自 Pinia,共享狀態必須走主進程
 *   - JWT 已經是內存狀態(不持久化),這層複製到主進程仍只活在 app 生命週期
 *
 * 為什麼跟 work-collect 的 BASE_URL 共用環境變數:後端是同一個 tmbom 服務,
 *   分開維護兩份地址只會在改 prod 主機時漏改一邊。
 */

/** 後端 base URL — 跟 work-collect 共用環境變數,生產指向 IES 服器 */
const DEFAULT_BASE_URL: string =
    (process.env.VITE_WORK_COLLECT_API_URL as string | undefined) ?? 'http://localhost:5247'

let _userId = ''
let _token = ''
let _baseUrl = DEFAULT_BASE_URL

export const authContext = {
    /**
     * 由主窗在登入完成 / token 更新時呼叫。
     * baseUrl 可選,通常用預設;留出參數是為了將來 multi-tenant 切後端時可動態改。
     */
    set(userId: string, token = '', baseUrl?: string): void {
        _userId = userId
        _token = token
        if (baseUrl) _baseUrl = baseUrl
    },

    /** 子視窗 / handler 取當前身分 */
    get(): { userId: string; token: string; baseUrl: string } {
        return {userId: _userId, token: _token, baseUrl: _baseUrl}
    },

    /** 登出時呼叫,清空身分但保留 baseUrl */
    clear(): void {
        _userId = ''
        _token = ''
    },
}
