/**
 * SQLite + Drizzle 單例。
 *
 * 生命週期:
 *  - app.whenReady 後由 index.ts 呼叫 init() 一次 → 開檔、設 pragma、跑 migration
 *  - LogService 等業務層透過 getDb() 取 drizzle instance 操作
 *  - before-quit 內呼叫 close() 確保 WAL 落盤
 *
 * 失敗策略:init() 拋出例外讓上層 catch,上層決定降級行為。
 * 設計文件:[docs/08-本地數據庫設計.md §9](../../../docs/08-本地數據庫設計.md)
 */

import Database from 'better-sqlite3'
import {drizzle, type BetterSQLite3Database} from 'drizzle-orm/better-sqlite3'
import {migrate} from 'drizzle-orm/better-sqlite3/migrator'
import {app} from 'electron'
import path from 'path'
import * as schema from './schema'

export class DatabaseManager {
  private sqlite: Database.Database | null = null
  private db: BetterSQLite3Database<typeof schema> | null = null

  /**
   * 開啟資料庫並跑 migration。
   *
   * 路徑分流:
   *  - prod(已打包):`<userData>/app.db`(`%APPDATA%\ichiaDesktop\app.db`)
   *  - dev:專案根 `app.db`,跟現有 log-file-writer 的 dev 行為對齊,方便查資料
   *
   * migrations 目錄:
   *  - prod:打包時 viteStaticCopy 把 SQL 拷到 `out/main/migrations/`,
   *    `__dirname` 在 runtime 指向 out/main,因此 join 出來能找到
   *  - dev:`__dirname` 是 dev 暫存編譯目錄,要往回找原始路徑
   */
  init(): void {
    const dbPath = this.resolveDbPath()
    const migrationsFolder = this.resolveMigrationsFolder()

    this.sqlite = new Database(dbPath)
    // WAL:讀寫並發更好;FK:跟著開,後續加表用得到
    this.sqlite.pragma('journal_mode = WAL')
    this.sqlite.pragma('foreign_keys = ON')

    this.db = drizzle(this.sqlite, {schema})
    migrate(this.db, {migrationsFolder})
  }

  /** 取 drizzle instance。未 init 直接拋,避免靜默誤用 */
  getDb(): BetterSQLite3Database<typeof schema> {
    if (!this.db) throw new Error('DatabaseManager.init() 尚未呼叫')
    return this.db
  }

  /** 給 LogService 判斷「能不能寫」用 —— 失敗降級路徑下會是 false */
  isReady(): boolean {
    return this.db !== null
  }

  /** App 退出前呼叫,讓 WAL 內容 checkpoint 進主檔 */
  close(): void {
    this.sqlite?.close()
    this.sqlite = null
    this.db = null
  }

  /** dev 用專案根,prod 用 userData */
  private resolveDbPath(): string {
    if (app.isPackaged) {
      return path.join(app.getPath('userData'), 'app.db')
    }
    return path.join(app.getAppPath(), 'app.db')
  }

  /**
   * 找 drizzle migrations 目錄。
   *  - prod:`out/main/migrations/`(打包時 viteStaticCopy 把 SQL 帶過去)
   *  - dev:相對於 __dirname 往上找 `electron/main/db/migrations`
   */
  private resolveMigrationsFolder(): string {
    if (app.isPackaged) {
      // __dirname == <resources>/app.asar/out/main 之類,migrations 跟它平級
      return path.join(__dirname, 'migrations')
    }
    // dev:__dirname 指向 electron-vite 編譯後的暫存,直接回到專案根再下到 source
    return path.join(app.getAppPath(), 'electron', 'main', 'db', 'migrations')
  }
}
