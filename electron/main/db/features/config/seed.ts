/**
 * Config DB 初始化 — 從 `defaults.ts` 寫 DB(完全不讀任何 JSON 檔案)。
 *
 * 設計(方案 A):
 *   - **唯一 seed source 是 code 內的 `DEFAULT_CONFIG`**
 *   - 不再讀 `resources/app-config.json`(打包時已不 ship)
 *   - 不再讀 `userData/app-config.json`(既有檔案會被一次性 cleanup 刪掉)
 *
 * 啟動時行為:
 *   - DB 表為空 → 用 DEFAULT_CONFIG seed
 *   - DB 表非空 → 跳過 seed
 *   - 順手 cleanup:偵測到 userData/app-config.json 殘檔就刪掉(舊版本遺留)
 *
 * **既有使用者升級會丟失透過 UI 改過的設定**(語言、浮球位置、採集開關等),
 * 全部還原 default。這是方案 A 的明確取捨,接受換來架構乾淨。
 *
 * 失敗策略:throw 給 ConfigManager.load() 兜底,讓 app 用 DEFAULT_CONFIG 兜底起來。
 */

import {app} from 'electron'
import {existsSync, unlinkSync} from 'fs'
import {join} from 'path'
import type {BetterSQLite3Database} from 'drizzle-orm/better-sqlite3'
import {logger} from '../../../utils/logger'
import {DEFAULT_CONFIG} from './defaults'
import {allSingletons} from '.'
import {
  appSettingsKv,
  internalTools,
  personalTools,
  quickMenuItems,
  sidebarItems,
  systemLinks,
  unifiedPlatformSystems,
} from './schema'

/**
 * 若 DB 內 config 表為空,用 DEFAULT_CONFIG seed;
 * 順手把 userData 內舊版殘留的 app-config.json 刪掉(無論本次是否 seed)。
 */
export function seedOrMigrate(db: BetterSQLite3Database<any>): void {
  // ── 1. 順手 cleanup 舊版遺留 ──────────────────────────────────
  cleanupLegacyJson()

  // ── 2. 判斷是否已 seeded ─────────────────────────────────────
  const rows = db.select().from(appSettingsKv).limit(1).all()
  if (rows.length > 0) {
    return // 已 seeded,跳過
  }

  // ── 3. 用 DEFAULT_CONFIG seed(transaction) ──────────────────
  logger.info('Config 表為空,從 DEFAULT_CONFIG seed', 'ConfigSeed')

  db.transaction((tx) => {
    // singletons → app_settings_kv
    for (const [key, value] of allSingletons(DEFAULT_CONFIG)) {
      tx.insert(appSettingsKv).values({key, value: JSON.stringify(value), updatedAt: Date.now()}).run()
    }

    // collections → 6 張表
    DEFAULT_CONFIG.sidebar.items.forEach((it, ord) => {
      tx.insert(sidebarItems).values({
        id: it.id,
        label: it.label,
        icon: it.icon,
        routeName: it.routeName,
        enabled: it.enabled ? 1 : 0,
        badge: it.badge ?? null,
        ord,
      }).run()
    })

    DEFAULT_CONFIG.systemLinks.items.forEach((it, ord) => {
      tx.insert(systemLinks).values({
        id: it.id, label: it.label, icon: it.icon, url: it.url,
        enabled: it.enabled ? 1 : 0, ord,
      }).run()
    })

    DEFAULT_CONFIG.floatingBall.quickMenu.forEach((it, ord) => {
      tx.insert(quickMenuItems).values({
        id: it.id,
        label: it.label,
        icon: it.icon ?? null,
        enabled: it.enabled ? 1 : 0,
        separator: it.separator ? 1 : 0,
        actionType: it.action.type,
        actionRouteName: it.action.type === 'navigate' ? it.action.routeName : null,
        actionUrl: it.action.type === 'open-url' ? it.action.url : null,
        actionTarget: it.action.type === 'open-url' ? it.action.target : null,
        ord,
      }).run()
    })

    DEFAULT_CONFIG.unifiedPlatform.systems.forEach((it, ord) => {
      tx.insert(unifiedPlatformSystems).values({
        id: it.id,
        name: it.name,
        description: it.description,
        url: it.url,
        iconUrl: it.iconUrl ?? null,
        openMode: it.openMode,
        ssoEnabled: it.ssoEnabled ? 1 : 0,
        ssoTokenParam: it.ssoTokenParam ?? null,
        ord,
      }).run()
    })

    DEFAULT_CONFIG.internalFunctions.tools.forEach((it, ord) => {
      tx.insert(internalTools).values({
        id: it.id,
        name: it.name,
        description: it.description,
        icon: it.icon,
        enabled: it.enabled ? 1 : 0,
        openMode: it.openMode,
        routeName: it.routeName ?? null,
        url: it.url ?? null,
        ord,
      }).run()
    })

    DEFAULT_CONFIG.personalFunctions.tools.forEach((it, ord) => {
      tx.insert(personalTools).values({
        id: it.id,
        name: it.name,
        description: it.description,
        icon: it.icon,
        enabled: it.enabled ? 1 : 0,
        openMode: it.openMode,
        routeName: it.routeName ?? null,
        ord,
      }).run()
    })
  })

  logger.info('Config seed 完成', 'ConfigSeed')
}

// ── 內部 helper ──────────────────────────────────────────────────

/**
 * 偵測並刪除 userData 內舊版遺留的 app-config.json。
 * 舊版本(JSON 模式)會把使用者修改寫到這個檔案,新版本完全棄用。
 *
 * 不論本次啟動是否需要 seed,都跑一次:
 *   - 舊→新版本第一次啟動:檔案存在 → 刪除
 *   - 後續啟動:檔案不存在 → 無動作
 *   - dev 模式:`app.isPackaged === false`,跳過(dev 沒有 userData JSON 概念)
 *
 * 刪除失敗只 warn,不擴散 —— 檔案留著不影響功能,只是惱人。
 */
function cleanupLegacyJson(): void {
  if (!app.isPackaged) return

  const legacyPath = join(app.getPath('userData'), 'app-config.json')
  if (!existsSync(legacyPath)) return

  try {
    unlinkSync(legacyPath)
    logger.info('已刪除舊版 userData/app-config.json(config 已搬進 DB)', 'ConfigSeed')
  } catch (err) {
    logger.warn('舊版 app-config.json 刪除失敗,但不影響功能', 'ConfigSeed', err)
  }
}

