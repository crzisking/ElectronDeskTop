/**
 * 應用配置讀寫管理。
 *
 * runtime source 是 SQLite(`app.db` 的 7 張 config 表),**完全不讀任何 JSON 檔案**。
 * Seed 來源是 `defaults.ts` 內的 `DEFAULT_CONFIG` 常數,DB 為空時寫進去。
 *
 * 對外契約**完全不變**:
 *   - `load()` / `getConfig()` / `writeConfig()` / `getUpdateConfig()` 簽名一樣
 *   - IPC `CONFIG_READ` / `CONFIG_WRITE` 行為一致
 *   - 渲染端 `configStore.appConfig.X.Y` 100+ 處消費點 0 改動
 *
 * 內部實作:
 *   - `load()`:DB 已 init → seedOrMigrate(空表才寫)→ resyncDevOwnedConfig(dev-owned 強制 sync)→ assembleAppConfig 組裝
 *   - `getConfig()`:回 in-memory cache + 注入 `app.getVersion()`
 *   - `writeConfig(partial)`:repository.applyPartial(transaction)+ 重組 in-memory cache
 *
 * Dev-owned vs User-owned(見 repository.ts 內 USER_OWNED_KEYS):
 *   - Dev 改 defaults.ts 內的 collection 結構(sidebar / tools 等)→ 使用者升級後同步看到一致內容
 *   - 使用者個人偏好(語言 / 浮球位置 / 採集開關等)升級後保留
 *
 * 失敗策略:
 *   - load 任一步驟失敗 → 用 DEFAULT_CONFIG 兜底 + logger.error,讓 app 仍可啟動
 *   - writeConfig 失敗 → throw 給 IPC handler,讓 renderer 知道
 *
 * 配套設計:[docs/13-Config-DB-重構設計.md](../../docs/13-Config-DB-重構設計.md)
 */

import {app} from 'electron'
import {logger} from './utils/logger'
import type {AppConfig} from '../../src/types/config'
import type {DatabaseManager} from './db/database-manager'
import {DEFAULT_CONFIG} from './db/features/config/defaults'
import {applyPartial, assembleAppConfig, resyncDevOwnedConfig} from './db/features/config/repository'
import {seedOrMigrate} from './db/features/config/seed'

export class ConfigManager {
  /** in-memory cache;每次 load / writeConfig 後重新組裝 */
  private config: Omit<AppConfig, 'version'> = DEFAULT_CONFIG

  /**
   * @param dbManager DatabaseManager 必須已 init();main/index.ts 的順序已保證(DB 先於 ConfigManager)
   */
  constructor(private readonly dbManager: DatabaseManager) {}

  /**
   * 載入配置:
   *  1. 若 DB 空 → seed(從 DEFAULT_CONFIG)
   *  2. resyncDevOwnedConfig 把 dev-owned 設定強制同步成 defaults
   *     ── 6 張 collection 表整批 reset;部分 KV 散值 upsert
   *     ── user-owned KV(語言 / 浮球位置 / 採集開關 等)保留
   *  3. assembleAppConfig 把 DB 內 7 張表組成 AppConfig
   */
  async load(): Promise<void> {
    try {
      if (!this.dbManager.isReady()) {
        throw new Error('DatabaseManager 未就緒')
      }
      const db = this.dbManager.getDb()

      // 1. seed(空表才會跑)
      seedOrMigrate(db)

      // 2. 強制 dev-owned 設定同步成 defaults(讓 developer 改 defaults.ts 就 sync 給使用者)
      resyncDevOwnedConfig(db)

      // 3. 組裝
      this.config = assembleAppConfig(db)
      logger.info('配置從 DB 載入成功', 'ConfigManager')
    } catch (err) {
      logger.error('配置載入失敗,使用 DEFAULT_CONFIG 兜底', 'ConfigManager', err)
      this.config = DEFAULT_CONFIG
    }
  }

  /**
   * 取當前配置;version 字段在此處從 app.getVersion() 注入,
   * 跟 package.json / electron-updater 版本永遠一致。
   */
  getConfig(): AppConfig {
    return {...this.config, version: app.getVersion()}
  }

  /**
   * 取自動更新子配置(便利方法,UpdateManager 用)。
   */
  getUpdateConfig(): AppConfig['update'] {
    return this.config.update
  }

  /**
   * 寫入部分配置。
   * version 不允許寫(runtime 注入,不持久化)。
   * 寫入後重新 assemble 一次保持 in-memory cache 跟 DB 同步。
   */
  async writeConfig(partial: Partial<AppConfig>): Promise<void> {
    // version 不寫進 DB
    if ('version' in partial) {
      delete (partial as Record<string, unknown>).version
    }

    try {
      if (!this.dbManager.isReady()) {
        throw new Error('DatabaseManager 未就緒')
      }
      const db = this.dbManager.getDb()

      // 1. 走 transaction 分派寫入
      applyPartial(db, partial)

      // 2. 重新 assemble in-memory cache(讓 getConfig() 立刻拿到新值)
      this.config = assembleAppConfig(db)

      logger.info('配置已寫入 DB', 'ConfigManager')
    } catch (err) {
      logger.error('配置寫入失敗', 'ConfigManager', err)
      throw err
    }
  }
}
