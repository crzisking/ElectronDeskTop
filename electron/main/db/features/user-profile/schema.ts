/**
 * user_profiles 表 — 當前登入使用者的釘釘 ID + 基本資料快取。
 *
 * 單帳號模型:整張表同時只會有 1 行。
 * 偵測到 AD 帳號變更時,由 AccountChangeCleaner 跨表清空(本表 + work_records)。
 *
 * 配套設計:[docs/12-使用者身份同步設計.md](../../../../../docs/12-使用者身份同步設計.md)
 */

import {integer, sqliteTable, text} from 'drizzle-orm/sqlite-core'

export const userProfiles = sqliteTable('user_profiles', {
  /** 工號 / JWT subject,單帳號模型下永遠只會有 1 行 */
  userId: text('userId').primaryKey(),

  /** 釘釘員工 ID */
  dingId: text('dingId').notNull(),

  /** 釘釘 unionid(跨企業唯一) */
  unionId: text('unionId').notNull(),

  /** 顯示名(中文姓名),可空 */
  displayName: text('displayName'),

  /** Email,可空(釘釘 user.get 不一定有) */
  email: text('email'),

  /** 上次 /api/UserInfo/ding/userinfo 寫入時間(Unix ms) */
  syncedAt: integer('syncedAt').notNull(),
})

/** Drizzle 推導的 SELECT 行型別 */
export type UserProfile = typeof userProfiles.$inferSelect

/** Drizzle 推導的 INSERT 物件型別 */
export type NewUserProfile = typeof userProfiles.$inferInsert
