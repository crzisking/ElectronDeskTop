/**
 * 啟動時把「dev-owned」設定強制同步成 DEFAULT_CONFIG。
 *
 * 設計動機:讓開發者改 defaults.ts 後,使用者升級就看到一致結果。
 *
 * Dev-owned vs User-owned 區分:
 *  - **Dev-owned**(升級覆蓋):6 張 collection 表全部 + 部分 KV(feedUrl / apiBaseUrl 等)
 *  - **User-owned**(升級保留):語言 / 浮球位置 / 採集開關等個人偏好
 *
 * 後果:
 *  - 改 defaults.ts sidebar 順序 → 使用者升級看到新順序
 *  - 改 entry name / icon → 跟著變
 *  - 新增 entry → 自動出現,刪 entry → 使用者那邊也消失
 *  - 使用者改過的「個人偏好」保留
 *
 * 整段走一個 transaction,任一失敗 rollback。
 * 在 ConfigManager.load() 內 seed 完之後執行。
 */

import {DEFAULT_CONFIG} from './defaults'
import {
    internalTools,
    personalTools,
    quickMenuItems,
    sidebarItems,
    systemLinks,
    unifiedPlatformSystems,
} from './schema'
import {type Db, upsertKv} from './kv-helpers'
import {quickMenuToRow, resyncCollection} from './collection-helpers'

/**
 * 標記為「使用者個人偏好」的 KV key,升級時**不會被覆蓋**。
 *
 * 命名規則:純粹「使用者自己會調」的偏好欄位放這。
 * - 部署 / 基礎設施類欄位(feedUrl / apiBaseUrl 等)**不**加進來
 * - 公司強制策略類(launchOnStartup / update.enabled 等)**不**加進來
 *
 * 加新欄位時:若該欄位有 UI 給使用者改 + 公司允許個人化 → 加進此 set;否則就是 dev-owned。
 */
export const USER_OWNED_KEYS: ReadonlySet<string> = new Set([
    // app 個人偏好
    'app.language',
    'app.startMinimized',
    // 'app.launchOnStartup' 是公司強制策略,dev-owned
    // sidebar
    'sidebar.defaultCollapsed',
    // 浮球外觀 + 位置
    'floatingBall.size',
    'floatingBall.opacity',
    'floatingBall.defaultPosition',
    'floatingBall.snapToEdge',
    // 自動更新:只有 autoDownload 個人可控
    'update.autoDownload',
    // 統一平台:各系統打開方式的個人覆寫(桌面窗口 / 瀏覽器),不隨 systems collection 升級被沖掉
    'unifiedPlatform.openModeOverrides',
    // 工作採集
    'workCollect.enabled',
    'workCollect.intervalMinutes',
    'workCollect.workStartHour',
    'workCollect.workEndHour',
    'workCollect.categoryTemplateId',
    'workCollect.templateName',
])

export function resyncDevOwnedConfig(db: Db): void {
    db.transaction((tx) => {
        // ── 1. 6 張 collection 表:整批 reset 為 defaults ──────────
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
            quickMenuToRow(it, ord),
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
            windowId: it.windowId ?? null,
            ord,
        }))

        // ── 2. KV 散值:dev-owned 的 key upsert 成 default,user-owned 不動 ──
        for (const [key, value] of devOwnedSingletons()) {
            upsertKv(tx, key, value)
        }
    })
}

/** Dev-owned KV singleton(USER_OWNED_KEYS 補集) */
function devOwnedSingletons(): Array<[string, unknown]> {
    return allSingletons(DEFAULT_CONFIG).filter(([key]) => !USER_OWNED_KEYS.has(key))
}

/**
 * 列出所有 KV singleton(dev + user)。
 * 這份清單跟 schema 內 KV key 一一對應,schema 改了這裡同步。
 *
 * 對外暴露:seed.ts 首次寫入用。
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
        // unifiedPlatform(散值,systems 走 collection 表)
        ['unifiedPlatform.openModeOverrides', c.unifiedPlatform.openModeOverrides],
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
        // notification(dev-owned:wsUrl 等基礎建設值,使用者不該改;每次升級強制覆蓋)
        ['notification.enabled', c.notification.enabled],
        ['notification.wsUrl', c.notification.wsUrl],
        ['notification.pingIntervalMs', c.notification.pingIntervalMs],
        ['notification.reconnectMaxMs', c.notification.reconnectMaxMs],
    ]
}
