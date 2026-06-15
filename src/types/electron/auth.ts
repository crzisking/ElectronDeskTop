/**
 * electronAPI.auth 子介面 — AD 帳號 + JWT 登入。
 */

export interface AuthAPI {
    /**
     * 取本機 Windows 登入帳號名(如 "jacky.chen")。
     * 域機環境下即為 AD sAMAccountName,用於 AD 自動登入。
     * 非 Windows 平台 / 讀取失敗 → 返回空字串。
     */
    getAdAccount: () => Promise<string>

    /**
     * 以 AD 帳號名向後端換 JWT(HTTP 請求在主進程發,避開 CORS)。
     * 失敗 / 空回傳 / 超時都返回空字串,由呼叫方判定降級。
     * @param account Windows 帳號名
     * @returns JWT 字串;空字串視為失敗
     */
    adLogin: (account: string) => Promise<string>

    /**
     * 推主進程 authContext(主窗登入 / 登出時呼叫)。
     * 子視窗(Memos / LogViewer)以此為身分來源,不再各自存 token。
     * @param userId  工號;空字串表示清空
     * @param token   JWT(可選,目前主要靠 userId)
     * @param baseUrl 後端地址(可選)。VITE_* 只注入 renderer 編譯期,主進程 process.env 讀不到,
     *                故由 renderer 顯式帶上;不帶主進程會 fallback localhost,子視窗連不上正式後端。
     */
    setContext: (userId: string, token?: string, baseUrl?: string) => Promise<{ ok: true }>
}
