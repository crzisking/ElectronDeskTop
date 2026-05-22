/**
 * UserProfileService:user_profiles 表的業務 API。
 *
 *  - getActive():取唯一一行(單帳號模型);沒資料回 null
 *  - upsert():寫入或更新(以 userId 為 conflict target)
 *  - clearAll():清空整張表;**只在 AD 帳號變更時由 AccountChangeCleaner 呼叫**,避免到處亂清
 *
 * 容錯:寫入 / 查詢失敗只 console.error,不擴散到 caller —— 跟其他 service 一致。
 */

import type {DatabaseManager} from '../../database-manager'
import {userProfiles, type NewUserProfile, type UserProfile} from './schema'

export class UserProfileService {
  constructor(private readonly dbManager: DatabaseManager) {}

  /**
   * 取當前 active profile。
   * 單帳號模型下整張表最多 1 行,所以 LIMIT 1 就夠。
   */
  getActive(): UserProfile | null {
    if (!this.dbManager.isReady()) return null
    try {
      const row = this.dbManager
        .getDb()
        .select()
        .from(userProfiles)
        .limit(1)
        .get()
      return row ?? null
    } catch (err) {
      console.error('[UserProfileService] getActive 失敗', err)
      return null
    }
  }

  /**
   * 寫入或更新 profile。
   * 以 userId 為 conflict target:同工號 → 更新;新工號 → 插入。
   *
   * 注:正常流程下「帳號變更」會先走 AccountChangeCleaner.clearAllUserData() 清表,
   * 再 upsert 新行,所以這支實際上多半在「同工號刷新 displayName / email」場景被觸發。
   */
  upsert(entry: Omit<NewUserProfile, 'syncedAt'>): boolean {
    if (!this.dbManager.isReady()) return false
    try {
      this.dbManager
        .getDb()
        .insert(userProfiles)
        .values({...entry, syncedAt: Date.now()})
        .onConflictDoUpdate({
          target: userProfiles.userId,
          set: {
            dingId: entry.dingId,
            unionId: entry.unionId,
            displayName: entry.displayName ?? null,
            email: entry.email ?? null,
            syncedAt: Date.now(),
          },
        })
        .run()
      return true
    } catch (err) {
      console.error('[UserProfileService] upsert 失敗', err)
      return false
    }
  }

  /**
   * 清空整張表。**只給 AccountChangeCleaner 用**,業務代碼禁止直接呼叫。
   * 失敗會把錯誤往上拋,讓 cleaner 內的 transaction 能 rollback。
   */
  clearAll(): void {
    if (!this.dbManager.isReady()) return
    this.dbManager.getDb().delete(userProfiles).run()
  }
}
