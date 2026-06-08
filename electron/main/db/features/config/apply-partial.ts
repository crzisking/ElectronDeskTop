/**
 * Write 路徑:Partial<AppConfig> → 7 張表。
 *
 * 整批走一個 transaction,任一失敗 rollback。
 * Collection 採「整批替換」(DELETE 全表 + INSERT 新陣列);某 collection 缺少 = 不動該表。
 */

import type {AppConfig} from '@shared/types/config'
import {
    internalTools,
    personalTools,
    quickMenuItems,
    sidebarItems,
    systemLinks,
    unifiedPlatformSystems,
} from './schema'
import {type Db, upsertKv} from './kv-helpers'
import {quickMenuToRow} from './collection-helpers'

export function applyPartial(db: Db, partial: Partial<AppConfig>): void {
    db.transaction((tx) => {
        // ── app.* ──
        if (partial.app) {
            upsertKv(tx, 'app.language', partial.app.language)
            upsertKv(tx, 'app.startMinimized', partial.app.startMinimized)
            upsertKv(tx, 'app.launchOnStartup', partial.app.launchOnStartup)
        }

        // ── sidebar(defaultCollapsed 散值 + items collection)──
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
