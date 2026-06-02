/**
 * Config Repository — DB 跟 AppConfig 物件的轉換層。
 *
 * 三個對外 API:
 *  - assembleAppConfig():讀 7 張表組裝成 AppConfig(不含 version)
 *  - applyPartial(partial):分派 Partial<AppConfig> 寫入對應表,走 transaction
 *  - resyncDevOwnedConfig():啟動時把「dev-owned」設定強制同步成 DEFAULT_CONFIG
 *
 * Dev-owned vs User-owned 區分(見 USER_OWNED_KEYS):
 *  - **Dev-owned**(升級時覆蓋):6 張 collection 表全部 + 部分 KV(feedUrl / apiBaseUrl 等)
 *  - **User-owned**(升級時保留):語言 / 浮球位置 / 採集開關 / 工時等個人偏好
 *
 * 設計遵循:
 *  - 寫入永遠 transaction,任一失敗 rollback
 *  - Collection 採整批替換語意(對齊原 deepMerge 陣列替換規則)
 *  - boolean / null 在 SQLite 0/1 跟 TS boolean / undefined 之間有顯式 helper 轉換
 */

import type {BetterSQLite3Database} from 'drizzle-orm/better-sqlite3'
import type {AppConfig, QuickMenuAction, QuickMenuItem} from '../../../../../src/types/config'
import {DEFAULT_CONFIG} from './defaults'
import {
  appSettingsKv,
  internalTools,
  personalTools,
  type QuickMenuItemRow,
  quickMenuItems,
  sidebarItems,
  systemLinks,
  unifiedPlatformSystems,
} from './schema'

type Db = BetterSQLite3Database<any>

// ════════════════════════════════════════════════════════════════
//  Read:assembleAppConfig
// ════════════════════════════════════════════════════════════════

/**
 * 從 DB 7 張表組裝出 AppConfig(不含 version,version 由 ConfigManager.getConfig() 注入)。
 */
export function assembleAppConfig(db: Db): Omit<AppConfig, 'version'> {
  // 1. KV 散值
  const kvRows = db.select().from(appSettingsKv).all()
  const kv = new Map(kvRows.map((r) => [r.key, parseValue(r.value)]))

  // 2. 各 collection 表(ORDER BY ord)
  const sidebarRows = db.select().from(sidebarItems).orderBy(sidebarItems.ord).all()
  const systemLinkRows = db.select().from(systemLinks).orderBy(systemLinks.ord).all()
  const quickMenuRows = db.select().from(quickMenuItems).orderBy(quickMenuItems.ord).all()
  const upsRows = db.select().from(unifiedPlatformSystems).orderBy(unifiedPlatformSystems.ord).all()
  const internalRows = db.select().from(internalTools).orderBy(internalTools.ord).all()
  const personalRows = db.select().from(personalTools).orderBy(personalTools.ord).all()

  return {
    app: {
      language: getKv(kv, 'app.language', DEFAULT_CONFIG.app.language) as 'zh-TW' | 'en',
      startMinimized: getKv(kv, 'app.startMinimized', DEFAULT_CONFIG.app.startMinimized),
      launchOnStartup: getKv(kv, 'app.launchOnStartup', DEFAULT_CONFIG.app.launchOnStartup),
    },
    sidebar: {
      defaultCollapsed: getKv(kv, 'sidebar.defaultCollapsed', DEFAULT_CONFIG.sidebar.defaultCollapsed),
      items: sidebarRows.map((r) => ({
        id: r.id,
        label: r.label,
        icon: r.icon,
        routeName: r.routeName,
        enabled: r.enabled === 1,
        badge: r.badge ?? undefined,
      })),
    },
    systemLinks: {
      items: systemLinkRows.map((r) => ({
        id: r.id, label: r.label, icon: r.icon, url: r.url,
        enabled: r.enabled === 1,
      })),
    },
    floatingBall: {
      size: getKv(kv, 'floatingBall.size', DEFAULT_CONFIG.floatingBall.size),
      opacity: getKv(kv, 'floatingBall.opacity', DEFAULT_CONFIG.floatingBall.opacity),
      defaultPosition: getKv(kv, 'floatingBall.defaultPosition', DEFAULT_CONFIG.floatingBall.defaultPosition),
      snapToEdge: getKv(kv, 'floatingBall.snapToEdge', DEFAULT_CONFIG.floatingBall.snapToEdge),
      quickMenu: quickMenuRows.map(rowToQuickMenu),
    },
    unifiedPlatform: {
      systems: upsRows.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        url: r.url,
        iconUrl: r.iconUrl ?? undefined,
        openMode: r.openMode as 'iframe' | 'external-browser' | 'electron-window',
        ssoEnabled: r.ssoEnabled === 1,
        ssoTokenParam: r.ssoTokenParam ?? undefined,
      })),
    },
    internalFunctions: {
      apiBaseUrl: getKv(kv, 'internalFunctions.apiBaseUrl', DEFAULT_CONFIG.internalFunctions.apiBaseUrl),
      apiTimeout: getKv(kv, 'internalFunctions.apiTimeout', DEFAULT_CONFIG.internalFunctions.apiTimeout),
      tools: internalRows.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        icon: r.icon,
        enabled: r.enabled === 1,
        openMode: r.openMode as 'page' | 'external',
        routeName: r.routeName ?? undefined,
        url: r.url ?? undefined,
      })),
    },
    personalFunctions: {
      tools: personalRows.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        icon: r.icon,
        enabled: r.enabled === 1,
        openMode: r.openMode as 'page',
        routeName: r.routeName ?? undefined,
      })),
    },
    update: {
      enabled: getKv(kv, 'update.enabled', DEFAULT_CONFIG.update.enabled),
      feedUrl: getKv(kv, 'update.feedUrl', DEFAULT_CONFIG.update.feedUrl),
      channel: getKv(kv, 'update.channel', DEFAULT_CONFIG.update.channel),
      dailyCheckTime: getKv(kv, 'update.dailyCheckTime', DEFAULT_CONFIG.update.dailyCheckTime),
      autoDownload: getKv(kv, 'update.autoDownload', DEFAULT_CONFIG.update.autoDownload),
      autoInstallOnAppQuit: getKv(kv, 'update.autoInstallOnAppQuit', DEFAULT_CONFIG.update.autoInstallOnAppQuit),
    },
    workCollect: {
      enabled: getKv(kv, 'workCollect.enabled', DEFAULT_CONFIG.workCollect.enabled),
      intervalMinutes: getKv(kv, 'workCollect.intervalMinutes', DEFAULT_CONFIG.workCollect.intervalMinutes),
      workStartHour: getKv(kv, 'workCollect.workStartHour', DEFAULT_CONFIG.workCollect.workStartHour),
      workEndHour: getKv(kv, 'workCollect.workEndHour', DEFAULT_CONFIG.workCollect.workEndHour),
      categoryTemplateId: getKv(kv, 'workCollect.categoryTemplateId', null),
      templateName: getKv(kv, 'workCollect.templateName', null),
    },
  }
}

// ════════════════════════════════════════════════════════════════
//  Write:applyPartial
// ════════════════════════════════════════════════════════════════

/**
 * 把 Partial<AppConfig> 分派寫入對應的 KV row / collection 表。
 * 整批走一個 transaction,任一失敗 rollback。
 *
 * Collection 採「整批替換」(DELETE 全表 + INSERT 新陣列),對齊原 deepMerge 陣列替換語意。
 * 寫入的 partial 內某 collection 缺少 = 不動該表;傳了 = 整個替換。
 */
export function applyPartial(db: Db, partial: Partial<AppConfig>): void {
  db.transaction((tx) => {
    // ── app.* ──
    if (partial.app) {
      upsertKv(tx, 'app.language', partial.app.language)
      upsertKv(tx, 'app.startMinimized', partial.app.startMinimized)
      upsertKv(tx, 'app.launchOnStartup', partial.app.launchOnStartup)
    }

    // ── sidebar(defaultCollapsed 是 singleton;items 是 collection)──
    if (partial.sidebar) {
      upsertKv(tx, 'sidebar.defaultCollapsed', partial.sidebar.defaultCollapsed)
      if (partial.sidebar.items !== undefined) {
        tx.delete(sidebarItems).run()
        partial.sidebar.items.forEach((it, ord) => {
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
      }
    }

    // ── systemLinks.items ──
    if (partial.systemLinks?.items !== undefined) {
      tx.delete(systemLinks).run()
      partial.systemLinks.items.forEach((it, ord) => {
        tx.insert(systemLinks).values({
          id: it.id, label: it.label, icon: it.icon, url: it.url,
          enabled: it.enabled ? 1 : 0, ord,
        }).run()
      })
    }

    // ── floatingBall(散值 + quickMenu collection)──
    if (partial.floatingBall) {
      upsertKv(tx, 'floatingBall.size', partial.floatingBall.size)
      upsertKv(tx, 'floatingBall.opacity', partial.floatingBall.opacity)
      upsertKv(tx, 'floatingBall.defaultPosition', partial.floatingBall.defaultPosition)
      upsertKv(tx, 'floatingBall.snapToEdge', partial.floatingBall.snapToEdge)
      if (partial.floatingBall.quickMenu !== undefined) {
        tx.delete(quickMenuItems).run()
        partial.floatingBall.quickMenu.forEach((it, ord) => {
          tx.insert(quickMenuItems).values(quickMenuToRow(it, ord)).run()
        })
      }
    }

    // ── unifiedPlatform.systems ──
    if (partial.unifiedPlatform?.systems !== undefined) {
      tx.delete(unifiedPlatformSystems).run()
      partial.unifiedPlatform.systems.forEach((it, ord) => {
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
    }

    // ── internalFunctions(散值 + tools collection)──
    if (partial.internalFunctions) {
      upsertKv(tx, 'internalFunctions.apiBaseUrl', partial.internalFunctions.apiBaseUrl)
      upsertKv(tx, 'internalFunctions.apiTimeout', partial.internalFunctions.apiTimeout)
      if (partial.internalFunctions.tools !== undefined) {
        tx.delete(internalTools).run()
        partial.internalFunctions.tools.forEach((it, ord) => {
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
      }
    }

    // ── personalFunctions.tools ──
    if (partial.personalFunctions?.tools !== undefined) {
      tx.delete(personalTools).run()
      partial.personalFunctions.tools.forEach((it, ord) => {
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
    }

    // ── update.* ──
    if (partial.update) {
      upsertKv(tx, 'update.enabled', partial.update.enabled)
      upsertKv(tx, 'update.feedUrl', partial.update.feedUrl)
      upsertKv(tx, 'update.channel', partial.update.channel)
      upsertKv(tx, 'update.dailyCheckTime', partial.update.dailyCheckTime)
      upsertKv(tx, 'update.autoDownload', partial.update.autoDownload)
      upsertKv(tx, 'update.autoInstallOnAppQuit', partial.update.autoInstallOnAppQuit)
    }

    // ── workCollect.* ──
    if (partial.workCollect) {
      upsertKv(tx, 'workCollect.enabled', partial.workCollect.enabled)
      upsertKv(tx, 'workCollect.intervalMinutes', partial.workCollect.intervalMinutes)
      upsertKv(tx, 'workCollect.workStartHour', partial.workCollect.workStartHour)
      upsertKv(tx, 'workCollect.workEndHour', partial.workCollect.workEndHour)
      upsertKv(tx, 'workCollect.categoryTemplateId', partial.workCollect.categoryTemplateId)
      upsertKv(tx, 'workCollect.templateName', partial.workCollect.templateName)
    }
  })
}

// ════════════════════════════════════════════════════════════════
//  Resync:啟動時把「dev-owned」設定強制同步成 DEFAULT_CONFIG
//
//  設計動機:讓開發者改 defaults.ts 後,使用者升級就看到一致結果。
//  6 張 collection 表全部視為 dev-owned(整批 reset);
//  KV 散值按 USER_OWNED_KEYS 區分 —— 使用者個人偏好保留,其他 sync。
// ════════════════════════════════════════════════════════════════

/**
 * 標記為「使用者個人偏好」的 KV key,升級時**不會被覆蓋**。
 *
 * 命名規則:純粹「使用者自己會調」的偏好欄位放這。
 * 部署 / 基礎設施類欄位(feedUrl / apiBaseUrl 等)**不**加進來,
 * 確保發版時可以靠 defaults.ts 統一推送。
 *
 * 公司強制策略類欄位也**不**加進來(launchOnStartup / update.enabled /
 * update.autoInstallOnAppQuit 等),讓使用者改不掉、升級時強制 reset 回 default。
 *
 * 加新欄位時,若該欄位有 UI 給使用者改 + 公司允許個人化 → 加進這個 set;
 * 否則就是 dev-owned,留空即可。
 */
export const USER_OWNED_KEYS: ReadonlySet<string> = new Set([
  // app 個人偏好
  'app.language',
  'app.startMinimized',
  // 'app.launchOnStartup' 是公司強制策略(開機自啟),dev-owned,不允許關
  // sidebar 摺疊狀態
  'sidebar.defaultCollapsed',
  // 浮球外觀 + 位置(使用者會拖會調)
  'floatingBall.size',
  'floatingBall.opacity',
  'floatingBall.defaultPosition',
  'floatingBall.snapToEdge',
  // 自動更新:autoDownload 個人可控
  // 'update.enabled' / 'update.autoInstallOnAppQuit' 是公司強制策略,dev-owned
  // (自動更新必開、後台靜默安裝必開,讓使用者無感升級)
  'update.autoDownload',
  // 工作採集:使用者可調的所有部分
  'workCollect.enabled',
  'workCollect.intervalMinutes',
  'workCollect.workStartHour',
  'workCollect.workEndHour',
  'workCollect.categoryTemplateId',
  'workCollect.templateName',
])

/**
 * 啟動時強制 dev-owned 設定跟 `DEFAULT_CONFIG` 一致:
 *  - 6 張 collection 表:DELETE 全部 + 重 INSERT defaults(順序 / 名稱 / icon 全部覆蓋)
 *  - KV 散值:**非** USER_OWNED_KEYS 的 key 全部 upsert 成 default;USER_OWNED_KEYS 保留
 *
 * 後果(明確取捨):
 *  - 開發者改 `defaults.ts` 內 sidebar.items 順序 → 使用者升級看到新順序
 *  - 開發者改 entry name / icon → 使用者升級跟著變
 *  - 開發者新增 entry → 自動出現
 *  - 開發者刪 entry → 使用者那邊也消失
 *  - 使用者改過的「個人偏好」(語言 / 浮球位置 / 採集開關)保留
 *
 * 整體走一個 transaction,任一失敗 rollback。
 * 在 ConfigManager.load() 內 seed 完之後執行。
 */
export function resyncDevOwnedConfig(db: Db): void {
  db.transaction((tx) => {
    // ── 1. 6 張 collection 表:整批 reset 為 defaults ─────────────
    resyncCollection(tx, sidebarItems, DEFAULT_CONFIG.sidebar.items, (it, ord) => ({
      id: it.id,
      label: it.label,
      icon: it.icon,
      routeName: it.routeName,
      enabled: it.enabled ? 1 : 0,
      badge: it.badge ?? null,
      ord,
    }))

    resyncCollection(tx, systemLinks, DEFAULT_CONFIG.systemLinks.items, (it, ord) => ({
      id: it.id,
      label: it.label,
      icon: it.icon,
      url: it.url,
      enabled: it.enabled ? 1 : 0,
      ord,
    }))

    resyncCollection(tx, quickMenuItems, DEFAULT_CONFIG.floatingBall.quickMenu, (it, ord) =>
      quickMenuToRow(it, ord)
    )

    resyncCollection(tx, unifiedPlatformSystems, DEFAULT_CONFIG.unifiedPlatform.systems, (it, ord) => ({
      id: it.id,
      name: it.name,
      description: it.description,
      url: it.url,
      iconUrl: it.iconUrl ?? null,
      openMode: it.openMode,
      ssoEnabled: it.ssoEnabled ? 1 : 0,
      ssoTokenParam: it.ssoTokenParam ?? null,
      ord,
    }))

    resyncCollection(tx, internalTools, DEFAULT_CONFIG.internalFunctions.tools, (it, ord) => ({
      id: it.id,
      name: it.name,
      description: it.description,
      icon: it.icon,
      enabled: it.enabled ? 1 : 0,
      openMode: it.openMode,
      routeName: it.routeName ?? null,
      url: it.url ?? null,
      ord,
    }))

    resyncCollection(tx, personalTools, DEFAULT_CONFIG.personalFunctions.tools, (it, ord) => ({
      id: it.id,
      name: it.name,
      description: it.description,
      icon: it.icon,
      enabled: it.enabled ? 1 : 0,
      openMode: it.openMode,
      routeName: it.routeName ?? null,
      ord,
    }))

    // ── 2. KV 散值:dev-owned 的 key upsert 成 default,user-owned 不動 ──
    for (const [key, value] of devOwnedSingletons()) {
      upsertKv(tx, key, value)
    }
  })
}

/** 通用 collection reset 邏輯:整批 DELETE + 重 INSERT defaults */
function resyncCollection<T>(
  tx: Db,
  table: any,
  defaults: T[],
  toRow: (item: T, ord: number) => Record<string, any>
): void {
  tx.delete(table).run()
  defaults.forEach((item, ord) => {
    tx.insert(table).values(toRow(item, ord)).run()
  })
}

/**
 * 列出**dev-owned 的 KV singleton**(USER_OWNED_KEYS 補集)。
 * resyncDevOwnedConfig 用此列表 upsert,以下省略 user-owned 那些。
 */
function devOwnedSingletons(): Array<[string, unknown]> {
  return allSingletons(DEFAULT_CONFIG).filter(([key]) => !USER_OWNED_KEYS.has(key))
}

/**
 * 列出所有 KV singleton(dev + user)。
 * 這份清單跟 schema §4.1 的 key 列表一一對應,schema 改了這裡要同步。
 */
export function allSingletons(c: typeof DEFAULT_CONFIG): Array<[string, unknown]> {
  return [
    // app
    ['app.language', c.app.language],
    ['app.startMinimized', c.app.startMinimized],
    ['app.launchOnStartup', c.app.launchOnStartup],
    // sidebar
    ['sidebar.defaultCollapsed', c.sidebar.defaultCollapsed],
    // floatingBall(散值,quickMenu 走 collection 表)
    ['floatingBall.size', c.floatingBall.size],
    ['floatingBall.opacity', c.floatingBall.opacity],
    ['floatingBall.defaultPosition', c.floatingBall.defaultPosition],
    ['floatingBall.snapToEdge', c.floatingBall.snapToEdge],
    // internalFunctions(散值,tools 走 collection 表)
    ['internalFunctions.apiBaseUrl', c.internalFunctions.apiBaseUrl],
    ['internalFunctions.apiTimeout', c.internalFunctions.apiTimeout],
    // update
    ['update.enabled', c.update.enabled],
    ['update.feedUrl', c.update.feedUrl],
    ['update.channel', c.update.channel],
    ['update.dailyCheckTime', c.update.dailyCheckTime],
    ['update.autoDownload', c.update.autoDownload],
    ['update.autoInstallOnAppQuit', c.update.autoInstallOnAppQuit],
    // workCollect
    ['workCollect.enabled', c.workCollect.enabled],
    ['workCollect.intervalMinutes', c.workCollect.intervalMinutes],
    ['workCollect.workStartHour', c.workCollect.workStartHour],
    ['workCollect.workEndHour', c.workCollect.workEndHour],
    ['workCollect.categoryTemplateId', c.workCollect.categoryTemplateId ?? null],
    ['workCollect.templateName', c.workCollect.templateName ?? null],
  ]
}

// ════════════════════════════════════════════════════════════════
//  內部 helper
// ════════════════════════════════════════════════════════════════

/** 把 KV 表內字串值 parse 回 JS 型別 */
function parseValue(s: string): unknown {
  try {
    return JSON.parse(s)
  } catch {
    return s
  }
}

/** 從 kv map 取值,缺失或型別不對時 fallback 到 default */
function getKv<T>(kv: Map<string, unknown>, key: string, defaultVal: T): T {
  if (!kv.has(key)) return defaultVal
  const v = kv.get(key)
  if (v === null || v === undefined) return defaultVal
  return v as T
}

/** upsert 一個 KV row;undefined 不寫(讓 partial 部分欄位可被略過) */
function upsertKv(tx: Db, key: string, value: unknown): void {
  if (value === undefined) return
  tx.insert(appSettingsKv)
    .values({key, value: JSON.stringify(value), updatedAt: Date.now()})
    .onConflictDoUpdate({
      target: appSettingsKv.key,
      set: {value: JSON.stringify(value), updatedAt: Date.now()},
    })
    .run()
}

/** DB row → QuickMenuItem(還原 discriminated union action) */
function rowToQuickMenu(r: QuickMenuItemRow): QuickMenuItem {
  const action = rowToAction(r)
  return {
    id: r.id,
    label: r.label,
    icon: r.icon ?? undefined,
    enabled: r.enabled === 1,
    separator: r.separator === 1 ? true : undefined,
    action,
  }
}

function rowToAction(r: QuickMenuItemRow): QuickMenuAction {
  switch (r.actionType) {
    case 'show-main-window':
      return {type: 'show-main-window'}
    case 'navigate':
      return {type: 'navigate', routeName: r.actionRouteName ?? ''}
    case 'open-url':
      return {
        type: 'open-url',
        url: r.actionUrl ?? '',
        target: (r.actionTarget as 'browser' | 'iframe') ?? 'browser',
      }
    case 'quit-app':
      return {type: 'quit-app'}
    case 'open-agent':
      return {type: 'open-agent'}
    default:
      // 未知 actionType 兜底成「顯示主視窗」,避免 UI 直接炸
      return {type: 'show-main-window'}
  }
}

/** QuickMenuItem → DB row */
function quickMenuToRow(it: QuickMenuItem, ord: number) {
  return {
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
  }
}
