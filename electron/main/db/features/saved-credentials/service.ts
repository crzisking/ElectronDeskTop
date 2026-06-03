/**
 * SavedCredentialsService:saved_credentials 表的業務 API。
 *
 *  - get()    :取唯一一行(單帳號模型);沒紀錄回 null
 *  - save()   :寫入或更新(以 userId 為 conflict target)
 *  - clear()  :刪掉整張表(登出 / 首頁開關用)
 *
 * 容錯:寫入失敗 log + 回 false;讀取失敗 log + 回 null。
 * 不拋給 caller(對齊 UserProfileService 的慣例)。
 */

import {logger} from '../../../utils/logger'
import type {DatabaseManager} from '../../database-manager'
import {type NewSavedCredential, type SavedCredential, savedCredentials} from './schema'

export class SavedCredentialsService {
    constructor(private readonly dbManager: DatabaseManager) {
    }

    /** 取已記住的憑證(整張表最多 1 行) */
    get(): SavedCredential | null {
        if (!this.dbManager.isReady()) return null
        try {
            const row = this.dbManager
                .getDb()
                .select()
                .from(savedCredentials)
                .limit(1)
                .get()
            return row ?? null
        } catch (err) {
            logger.error('get 失敗', 'SavedCredentialsService', err)
            return null
        }
    }

    /**
     * 寫入或更新憑證。
     * 以 userId 為 conflict target — 換帳號(舊行 userId ≠ 新 userId)會留下舊 row,
     * 所以 save 前主動清一次,確保整張表始終最多 1 行。
     */
    save(entry: Omit<NewSavedCredential, 'updatedAt'>): boolean {
        if (!this.dbManager.isReady()) return false
        try {
            this.dbManager.getDb().transaction((tx) => {
                tx.delete(savedCredentials).run()
                tx.insert(savedCredentials)
                    .values({...entry, updatedAt: Date.now()})
                    .run()
            })
            return true
        } catch (err) {
            logger.error('save 失敗', 'SavedCredentialsService', err)
            return false
        }
    }

    /** 清空整張表(登出 / 首頁開關 / AccountChangeCleaner 跨帳號清空時呼叫) */
    clear(): boolean {
        if (!this.dbManager.isReady()) return false
        try {
            this.dbManager.getDb().delete(savedCredentials).run()
            return true
        } catch (err) {
            logger.error('clear 失敗', 'SavedCredentialsService', err)
            return false
        }
    }
}
