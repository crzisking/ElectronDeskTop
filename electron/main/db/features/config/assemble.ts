/**
 * Read 路徑:7 張表 → AppConfig。
 *
 * 不含 `version`,version 由 ConfigManager.getConfig() 從 app.getVersion() runtime 注入。
 */

import type {AppConfig} from '@shared/types/config'
import {DEFAULT_CONFIG} from './defaults'
import {
    appSettingsKv,
    internalTools,
    personalTools,
    quickMenuItems,
    sidebarItems,
    systemLinks,
    unifiedPlatformSystems,
} from './schema'
import {type Db, getKv, parseValue} from './kv-helpers'
import {rowToQuickMenu} from './collection-helpers'

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
            mode: getKv(kv, 'floatingBall.mode', DEFAULT_CONFIG.floatingBall.mode),
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
            openModeOverrides: getKv(
                kv, 'unifiedPlatform.openModeOverrides', DEFAULT_CONFIG.unifiedPlatform.openModeOverrides,
            ),
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
                openMode: r.openMode as 'page' | 'window',
                routeName: r.routeName ?? undefined,
                windowId: r.windowId ?? undefined,
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
        notification: {
            enabled: getKv(kv, 'notification.enabled', DEFAULT_CONFIG.notification.enabled),
            wsUrl: getKv(kv, 'notification.wsUrl', DEFAULT_CONFIG.notification.wsUrl),
            pingIntervalMs: getKv(kv, 'notification.pingIntervalMs', DEFAULT_CONFIG.notification.pingIntervalMs),
            reconnectMaxMs: getKv(kv, 'notification.reconnectMaxMs', DEFAULT_CONFIG.notification.reconnectMaxMs),
        },
    }
}
