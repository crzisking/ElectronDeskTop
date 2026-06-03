/**
 * saved_credentials 表 — 登入頁「記住密碼」存的本機憑證。
 *
 * 跟 user_profiles 解耦的設計理由:
 *  - user_profiles 是「同步自釘釘的身份快取」,AccountChangeCleaner 偵測 AD 帳號變更會清空
 *  - 把密碼塞進去會被一起清,語義也不對(身份 vs 登入憑證)
 *  - 獨立一張表,清/留策略由 saved-credentials 自己決定
 *
 * 單帳號模型:整張表同時只會有 0 或 1 行(以 userId PK 衝突 → upsert)。
 *
 * ⚠ 安全注記:password 為明文存放,屬有意決策(無 AD 帳號用戶請求免登入便利)。
 *   檔案落在使用者 userData/app.db 內,跟其他本機資料同等保護等級;
 *   日後若要改加密,改 schema + 寫入/讀取兩端即可,API 不需動。
 */

import {integer, sqliteTable, text} from 'drizzle-orm/sqlite-core'

export const savedCredentials = sqliteTable('saved_credentials', {
    /** 工號,單帳號模型下永遠只會有 1 行 */
    userId: text('userId').primaryKey(),

    /** 明文密碼。設計上接受純文字,見檔頭安全注記 */
    password: text('password').notNull(),

    /** 最後一次寫入時間(Unix ms) */
    updatedAt: integer('updatedAt').notNull(),
})

export type SavedCredential = typeof savedCredentials.$inferSelect
export type NewSavedCredential = typeof savedCredentials.$inferInsert
