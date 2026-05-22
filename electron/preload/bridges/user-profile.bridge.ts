/**
 * 使用者身份同步 bridge。
 *
 * 渲染端透過此 bridge:
 *  - getActive():登入後比對「JWT 工號 vs DB 工號」用
 *  - upsert():拿到後端 /api/UserInfo/ding/userinfo 結果後寫進 DB
 *  - accountChangedClear():偵測到帳號變更時通知主進程清空 per-user 表
 */
import type {IpcRenderer} from 'electron'

export interface UserProfileChannelMap {
  USER_PROFILE_GET_ACTIVE: string
  USER_PROFILE_UPSERT: string
  ACCOUNT_CHANGED_CLEAR: string
}

export function createUserProfileBridge(ipc: IpcRenderer, ch: UserProfileChannelMap) {
  return {
    getActive: () => ipc.invoke(ch.USER_PROFILE_GET_ACTIVE),
    upsert: (payload: unknown) => ipc.invoke(ch.USER_PROFILE_UPSERT, payload) as Promise<boolean>,
    accountChangedClear: (payload: {oldUserId: string | null; newUserId: string}) =>
      ipc.invoke(ch.ACCOUNT_CHANGED_CLEAR, payload) as Promise<boolean>,
  }
}
