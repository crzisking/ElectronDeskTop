/**
 * 使用者身份同步相關型別。
 *
 *  - UserProfile             :本機 user_profiles 表的 row(從主進程 schema re-export)
 *  - UserProfileUpsertInput  :IPC USER_PROFILE_UPSERT 的 payload(syncedAt 由主進程填)
 *  - DingUserResponse        :後端 /api/UserInfo/ding/userinfo 的 .data
 *  - ProfileState            :store 公開的同步狀態
 */

// 跨進程 type-only import:relative path 跨 src/ → electron/main/。
// 只引型別,vite 不會把主進程代碼打進 renderer bundle。
export type {UserProfile} from '../../../electron/main/db/features/user-profile/schema'

/**
 * 寫進 user_profiles 的 payload。
 * syncedAt 不傳 —— 主進程 upsert 時自動填 Date.now()。
 */
export interface UserProfileUpsertInput {
  userId: string
  dingId: string
  unionId: string
  displayName?: string | null
  email?: string | null
}

/**
 * 後端 /api/UserInfo/ding/userinfo 回傳的 .data 結構(對齊 ichia.Model.Response.DingUserResponse)。
 * 釘釘原回傳含更多欄位(hideMobile / senior / boss / 等等),這裡只列我方會用的;
 * Newtonsoft 序列化保留 lowercase 欄位名,前端 interface 也對齊。
 */
export interface DingUserResponse {
  userId: string         // 釘釘員工 ID(= 我方 dingId)
  unionId: string
  name: string           // 顯示名
  avatar: string
  jobNumber: string      // 工號(= JWT userName,二次校驗用)
  title: string          // 職稱
  deptIdList: number[]
  hiredDate: number
  active: boolean
  realAuthed: boolean
}

/** store 對外暴露的同步狀態(UI 用此決定渲染) */
export type ProfileState = 'idle' | 'syncing' | 'ready' | 'syncError'
