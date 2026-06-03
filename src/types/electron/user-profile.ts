/**
 * electronAPI.userProfile 子介面 — 使用者身份同步。
 */

import type {UserProfile, UserProfileUpsertInput} from '@/features/user-profile/types'

export interface UserProfileAPI {
    /**
     * 取本機 SQLite 內的 active profile(單帳號模型下只會有 0 或 1 行)。
     * @returns UserProfile 或 null(尚未同步過)
     */
    getActive: () => Promise<UserProfile | null>

    /**
     * 寫入或更新 profile(以 userId 為 conflict target)。
     * @returns true 成功 / false 失敗
     */
    upsert: (payload: UserProfileUpsertInput) => Promise<boolean>

    /**
     * 偵測到 AD 帳號變更,通知主進程跨表清空所有 per-user 表(走 transaction)。
     * @returns true 清空成功 / false rollback
     */
    accountChangedClear: (payload: {
        oldUserId: string | null
        newUserId: string
    }) => Promise<boolean>
}
