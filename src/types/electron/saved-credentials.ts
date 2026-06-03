/**
 * electronAPI.savedCredentials 子介面 — 登入頁「記住密碼」憑證讀寫。
 *
 * 啟動鉤子 / LoginView / 登出 / 首頁清除按鈕都走這條。
 */

export interface SavedCredentialEntry {
    userId: string
    password: string
    updatedAt: number
}

export interface SavedCredentialsAPI {
    /** 取已記住的憑證;沒紀錄回 null */
    get: () => Promise<SavedCredentialEntry | null>

    /** 寫入或更新已記住的憑證(內部會先清舊行,確保最多 1 筆) */
    save: (payload: { userId: string; password: string }) => Promise<boolean>

    /** 清空已記住的憑證(登出 / 首頁清除按鈕) */
    clear: () => Promise<boolean>
}
