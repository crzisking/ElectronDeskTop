/**
 * AccountChangeCleaner — AD 帳號變更時的跨表清空服務。
 *
 * 為什麼集中在這支:
 *  - 「per-user 表有哪些」是會長大的清單(目前 2 張:user_profiles + work_records,
 *    未來新增任何屬於使用者個人的表也要加進來)
 *  - 散落在各 service 各自清,有任何一處漏掉就會洩漏前一人資料
 *  - 跨表清空必須走 transaction,失敗 rollback;不能讓一張清成功、一張失敗
 *
 * 觸發時機:渲染端登入後偵測到 JWT.userName 跟 DB 內 user_profiles.userId 不一致,
 * 透過 IPC ACCOUNT_CHANGED_CLEAR 呼叫本服務的 clearAllUserData()。
 *
 * 配套設計:[docs/12-使用者身份同步設計.md](../../../docs/12-使用者身份同步設計.md) §6
 */

import {logger} from '../utils/logger'
import {savedCredentials, userProfiles, workRecords} from './features'
import type {DatabaseManager} from './database-manager'
import type {WorkRecordService} from './features/work-collect/service'

export class AccountChangeCleaner {
  /**
   * workRecordService 用於 invalidate in-memory unsynced counter — 我們繞過 service 直接
   * `tx.delete(workRecords)`,service 內維護的 counter 會跟 DB 不一致,清完務必 invalidate。
   * 可選注入:DB 初始化失敗時 workRecordService 為 null,cleaner 仍能跑,只是 counter 不重設
   * (反正那條路徑下 service 自己也不可用)。
   */
  constructor(
      private readonly dbManager: DatabaseManager,
      private readonly workRecordService: WorkRecordService | null = null,
  ) {
  }

  /**
   * 清空所有 per-user 表。**走 transaction,任一表失敗都 rollback,不會留下半清空狀態**。
   *
   * 加新的 per-user 表時:在這函式內加一行 `tx.delete(<新表>).run()`,單一 source of truth。
   *
   * @returns true 表示成功;false 表示交易 rollback(DB 狀態維持原樣)
   */
  clearAllUserData(): boolean {
    if (!this.dbManager.isReady()) {
      logger.warn('DB 未就緒,跳過帳號變更清空', 'AccountChangeCleaner')
      return false
    }

    try {
      this.dbManager.getDb().transaction((tx) => {
        tx.delete(userProfiles).run()
        tx.delete(workRecords).run()
        // saved_credentials 屬於 per-user 表 — 跨帳號時舊密碼絕不能留給新帳號用,
        // 否則下次啟動會用舊憑證自動登入(換帳號又被切回去)
        tx.delete(savedCredentials).run()
        // 未來新增 per-user 表:
        //   tx.delete(<新表>).run()
      })
      // 跨表 delete 繞過 WorkRecordService,counter 失準 → 強制下次 countUnsynced() 重算
      this.workRecordService?.invalidateUnsyncedCount()
      logger.info('AD 帳號變更,已清空所有 per-user 表(user_profiles + work_records + saved_credentials)', 'AccountChangeCleaner')
      return true
    } catch (err) {
      logger.error('帳號變更清空交易失敗,DB 維持原狀', 'AccountChangeCleaner', err)
      return false
    }
  }
}
