/**
 * Schema 出口:把每張表 re-export 出去。
 * DatabaseManager `drizzle(sqlite, { schema: * as schema })` 會吸收這裡所有的 table,
 * 讓 `db.query.<tableName>.findMany()` 等 relational API 都能用。
 */
export * from './logs'
