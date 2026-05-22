/**
 * 使用者身份同步相關 IPC channels。
 * 配套設計:docs/12-使用者身份同步設計.md
 */
export const UserProfileChannels = {
  /**
   * 取當前 active profile(主進程查 SQLite)。
   * invoke。返回:UserProfile | null
   */
  USER_PROFILE_GET_ACTIVE: 'user-profile:get-active',

  /**
   * 寫入或更新 profile。
   * invoke。payload:{ userId, dingId, unionId, displayName?, email? }。
   * 返回:boolean(成功 / 失敗)
   */
  USER_PROFILE_UPSERT: 'user-profile:upsert',

  /**
   * 偵測到 AD 帳號變更,通知主進程清空所有 per-user 表(走 transaction)。
   * invoke。payload:{ oldUserId: string | null, newUserId: string }
   * 返回:boolean(清空成功 / rollback)
   */
  ACCOUNT_CHANGED_CLEAR: 'user-profile:account-changed-clear',
} as const
