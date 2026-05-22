/**
 * 使用者身份同步 IPC handler。
 *
 * Channels:
 *  - USER_PROFILE_GET_ACTIVE:查當前 active row,給渲染端比對「JWT 工號 vs DB 工號」用
 *  - USER_PROFILE_UPSERT    :渲染端拿到 /api/UserInfo/ding/userinfo 結果後寫進 DB
 *  - ACCOUNT_CHANGED_CLEAR  :偵測到帳號變更,走 AccountChangeCleaner 跨表清空
 *
 * 配套設計:[docs/12-使用者身份同步設計.md](../../../docs/12-使用者身份同步設計.md)
 */

import {ipcMain} from 'electron'
import {IpcChannels} from '../../shared/ipc-channels'
import {logger} from '../utils/logger'
import type {UserProfileService} from '../db/features/user-profile/service'
import type {AccountChangeCleaner} from '../db/account-change-cleaner'
import type {NewUserProfile, UserProfile} from '../db/features/user-profile/schema'

/** USER_PROFILE_UPSERT 的 payload(渲染端送的),syncedAt 由主進程自動填,renderer 不必傳 */
type UpsertPayload = Omit<NewUserProfile, 'syncedAt'>

/** ACCOUNT_CHANGED_CLEAR 的 payload */
interface AccountChangedPayload {
  oldUserId: string | null
  newUserId: string
}

export function registerUserProfileHandlers(
  userProfileService: UserProfileService | null,
  accountChangeCleaner: AccountChangeCleaner | null
): void {
  // ── 查當前 active profile ─────────────────────────────────────────
  ipcMain.handle(
    IpcChannels.USER_PROFILE_GET_ACTIVE,
    (): UserProfile | null => {
      if (!userProfileService) return null
      return userProfileService.getActive()
    }
  )

  // ── 寫入 / 更新 profile ──────────────────────────────────────────
  ipcMain.handle(
    IpcChannels.USER_PROFILE_UPSERT,
    (_event, payload: UpsertPayload): boolean => {
      if (!userProfileService) {
        logger.warn('USER_PROFILE_UPSERT 來了但 DB service 不可用', 'IPC:user-profile')
        return false
      }
      return userProfileService.upsert(payload)
    }
  )

  // ── 帳號變更,清空所有 per-user 表 ───────────────────────────────
  ipcMain.handle(
    IpcChannels.ACCOUNT_CHANGED_CLEAR,
    (_event, payload: AccountChangedPayload): boolean => {
      if (!accountChangeCleaner) {
        logger.warn('ACCOUNT_CHANGED_CLEAR 來了但 cleaner 不可用', 'IPC:user-profile')
        return false
      }
      logger.info(
        `偵測到帳號變更 oldUserId=${payload.oldUserId} → newUserId=${payload.newUserId}`,
        'IPC:user-profile'
      )
      return accountChangeCleaner.clearAllUserData()
    }
  )
}
