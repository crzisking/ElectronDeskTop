/**
 * Drizzle Kit 設定。
 *
 * 用途:
 *  - 指向 schema 統一出口,讓 `drizzle-kit generate` 能對照差異產 migration
 *  - 指向 migrations 輸出位置(跟主進程 db/migrations/ 同一個目錄)
 *
 * 注意:此設定**只給 drizzle-kit CLI 用**,runtime 不會載入。
 * runtime 連 DB / 跑 migration 走 electron/main/db/database-manager.ts。
 */
import {defineConfig} from 'drizzle-kit'

export default defineConfig({
  schema: './electron/main/db/schema/index.ts',
  out: './electron/main/db/migrations',
  dialect: 'sqlite',
  verbose: true,
  strict: true,
})
