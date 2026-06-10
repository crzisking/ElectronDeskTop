/**
 * 應用配置(config)表組 — 共 7 張表。
 *
 *  - 1 張 KV 表收所有 singleton 散值(app.language / floatingBall.size / update.enabled / 等等)
 *  - 6 張 collection 表收陣列型設定(sidebar items / tools / systems / quickMenu items 等)
 *
 * 設計取捨見 [docs/13-Config-DB-重構設計.md](../../../../../docs/13-Config-DB-重構設計.md):
 *  - 為什麼用 ord 而非 order:order 是 SQL keyword,跨工具輸入易踩坑
 *  - 為什麼 boolean 用 INTEGER 0/1:SQLite 沒原生 boolean,跟 work_records.isDone 慣例一致
 *  - 為什麼 KV.value 一律 stringify:避免弱型別混淆,反序列化集中在 repository 一處
 */

import {index, integer, sqliteTable, text} from 'drizzle-orm/sqlite-core'

// ── KV singleton 群 ──────────────────────────────────────────────

export const appSettingsKv = sqliteTable('app_settings_kv', {
  /** 例 'app.language' / 'workCollect.intervalMinutes' / 'floatingBall.defaultPosition' */
  key: text('key').primaryKey(),
  /** 一律 JSON.stringify 過的值(數字 / 布林 / 物件統一字串化) */
  value: text('value').notNull(),
  /** 最後寫入 Unix ms */
  updatedAt: integer('updatedAt').notNull(),
})

// ── Collection 表 6 張 ───────────────────────────────────────────

export const sidebarItems = sqliteTable(
  'sidebar_items',
  {
    id: text('id').primaryKey(),
    label: text('label').notNull(),
    icon: text('icon').notNull(),
    routeName: text('routeName').notNull(),
    /** 0/1 boolean */
    enabled: integer('enabled').notNull().default(1),
    /** 徽章文字(可空,例:'New' / '99+') */
    badge: text('badge'),
    /** 渲染順序;數字小在前 */
    ord: integer('ord').notNull(),
  },
  (table) => ({
    idxOrd: index('idx_sidebar_items_ord').on(table.ord),
  })
)

export const systemLinks = sqliteTable(
  'system_links',
  {
    id: text('id').primaryKey(),
    label: text('label').notNull(),
    icon: text('icon').notNull(),
    url: text('url').notNull(),
    enabled: integer('enabled').notNull().default(1),
    ord: integer('ord').notNull(),
  },
  (table) => ({
    idxOrd: index('idx_system_links_ord').on(table.ord),
  })
)

/**
 * 浮球右鍵菜單 entry。
 * action 是 discriminated union,DB 內拆 4 個欄位儲存,repository 組裝時依 actionType 還原。
 */
export const quickMenuItems = sqliteTable(
  'quick_menu_items',
  {
    id: text('id').primaryKey(),
    label: text('label').notNull(),
    /** 可空,Element Plus 圖標名 */
    icon: text('icon'),
    enabled: integer('enabled').notNull().default(1),
    /** 0/1;true 時渲染為分隔線,其他欄位被忽略(但仍需有合法 actionType) */
    separator: integer('separator').notNull().default(0),
    /** 'show-main-window' / 'navigate' / 'open-url' / 'quit-app' */
    actionType: text('actionType').notNull(),
    /** 只在 actionType='navigate' 時非空 */
    actionRouteName: text('actionRouteName'),
    /** 只在 actionType='open-url' 時非空 */
    actionUrl: text('actionUrl'),
    /** 只在 actionType='open-url' 時:'browser' / 'iframe' */
    actionTarget: text('actionTarget'),
    ord: integer('ord').notNull(),
  },
  (table) => ({
    idxOrd: index('idx_quick_menu_items_ord').on(table.ord),
  })
)

export const unifiedPlatformSystems = sqliteTable(
  'unified_platform_systems',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    url: text('url').notNull(),
    /** 可空,圖標 URL */
    iconUrl: text('iconUrl'),
    /** 'iframe' / 'external-browser' / 'electron-window' */
    openMode: text('openMode').notNull(),
    ssoEnabled: integer('ssoEnabled').notNull().default(0),
    /** SSO query param 名;ssoEnabled=1 時通常非空 */
    ssoTokenParam: text('ssoTokenParam'),
    ord: integer('ord').notNull(),
  },
  (table) => ({
    idxOrd: index('idx_unified_platform_systems_ord').on(table.ord),
  })
)

export const internalTools = sqliteTable(
  'internal_tools',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    icon: text('icon').notNull(),
    enabled: integer('enabled').notNull().default(1),
    /** 'page' / 'external' */
    openMode: text('openMode').notNull(),
    /** openMode='page' 時對應 Vue Router name */
    routeName: text('routeName'),
    /** openMode='external' 時對應外部 URL */
    url: text('url'),
    ord: integer('ord').notNull(),
  },
  (table) => ({
    idxOrd: index('idx_internal_tools_ord').on(table.ord),
  })
)

export const personalTools = sqliteTable(
  'personal_tools',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    icon: text('icon').notNull(),
    enabled: integer('enabled').notNull().default(1),
      /** 'page'(走 router) / 'window'(走獨立 BrowserWindow) */
    openMode: text('openMode').notNull(),
      /** 僅 openMode='page' 使用 */
    routeName: text('routeName'),
      /** 僅 openMode='window' 使用,目前支援 'memos' */
      windowId: text('windowId'),
    ord: integer('ord').notNull(),
  },
  (table) => ({
    idxOrd: index('idx_personal_tools_ord').on(table.ord),
  })
)

// ── 推導型別,給 repository / service 用 ──────────────────────────

export type AppSettingsKvRow = typeof appSettingsKv.$inferSelect
export type NewAppSettingsKv = typeof appSettingsKv.$inferInsert

export type SidebarItemRow = typeof sidebarItems.$inferSelect
export type SystemLinkRow = typeof systemLinks.$inferSelect
export type QuickMenuItemRow = typeof quickMenuItems.$inferSelect
export type UnifiedPlatformSystemRow = typeof unifiedPlatformSystems.$inferSelect
export type InternalToolRow = typeof internalTools.$inferSelect
export type PersonalToolRow = typeof personalTools.$inferSelect
