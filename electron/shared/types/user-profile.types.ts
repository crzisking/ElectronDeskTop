/**
 * 使用者身份同步 — IPC payload 型別。
 * main / renderer 共享。
 */

/** ACCOUNT_CHANGED_CLEAR 的 payload。偵測到 AD 帳號變更時 renderer 通知 main 跨表清空 per-user 資料 */
export interface AccountChangedPayload {
    oldUserId: string | null
    newUserId: string
}
