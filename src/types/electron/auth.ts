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
}
