/**
 * Collection 表的共用 helper。
 *
 * Collection 表(sidebar / quickMenu / unifiedPlatform 等)採「整批替換」語意:
 * 寫入時 DELETE 全表 + INSERT 新陣列;對齊舊版 deepMerge 的陣列覆寫規則。
 *
 * 本檔提供:
 *  - resyncCollection: 通用 DELETE + INSERT 操作(reseed 跟 partial write 共用)
 *  - quickMenuToRow / rowToQuickMenu:特殊的 discriminated union(action.type)轉換
 */

import type {QuickMenuAction, QuickMenuItem} from '@shared/types/config'
import type {QuickMenuItemRow} from './schema'
import type {Db} from './kv-helpers'

/** 整批 DELETE + 重 INSERT defaults。reseed / partial write 共用 */
export function resyncCollection<T>(
    tx: Db,
    table: any,
    items: T[],
    toRow: (item: T, ord: number) => Record<string, any>,
): void {
    tx.delete(table).run()
    items.forEach((item, ord) => {
        tx.insert(table).values(toRow(item, ord)).run()
    })
}

// ─── QuickMenu 特殊處理(action 是 discriminated union)───────────

/** DB row → QuickMenuItem,還原 action discriminated union */
export function rowToQuickMenu(r: QuickMenuItemRow): QuickMenuItem {
    return {
        id: r.id,
        label: r.label,
        icon: r.icon ?? undefined,
        enabled: r.enabled === 1,
        separator: r.separator === 1 ? true : undefined,
        action: rowToAction(r),
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
        default:
            // 未知 actionType 兜底成「顯示主視窗」,避免 UI 直接炸
            return {type: 'show-main-window'}
    }
}

/** QuickMenuItem → DB row */
export function quickMenuToRow(it: QuickMenuItem, ord: number) {
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
