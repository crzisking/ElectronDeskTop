/**
 * DB schema 統一出口(drizzle-kit + DatabaseManager 都吃這條 barrel)。
 *
 * 每個 feature 目錄包含:
 *  - schema.ts:drizzle table 定義 + 推導出的 SELECT / INSERT 型別
 *  - service.ts:該 feature 的 DB 業務 API(insert / list / cleanup 等)
 *
 * 新增 feature 步驟:
 *  1. 在 features/<name>/schema.ts 定義 table
 *  2. 在 features/<name>/service.ts 寫 CRUD
 *  3. 在這支 index.ts 加一行 `export * from './<name>/schema'`
 *  4. 跑 `npm run db:generate` 產生 migration
 */

export * from './logs/schema'
export * from './work-collect/schema'
export * from './user-profile/schema'
export * from './config/schema'
export * from './agent/schema'
export * from './saved-credentials/schema'
export * from './work-analysis/schema'
export * from './daily-advice/schema'
