/**
 * 統一平台系統卡片的「打開方式」解析 —— 使用者覆寫 vs 管理員預設。
 * 純函式,UnifiedPlatformView / SystemCard 共用,可單測。
 */
import type {SystemLink} from '@shared/types/config'

export type UserToggleableMode = 'electron-window' | 'external-browser'

/**
 * 解析某系統實際要用的打開方式:
 *   iframe 系統 → 恆用管理員設定(不開放使用者覆寫)
 *   非 iframe 系統 → 有覆寫用覆寫,沒有用管理員預設(system.openMode)
 */
export function resolveOpenMode(
    system: SystemLink,
    overrides: Record<string, UserToggleableMode> | undefined,
): SystemLink['openMode'] {
    if (system.openMode === 'iframe') return 'iframe'
    return overrides?.[system.id] ?? system.openMode
}

/** 這個系統要不要顯示「桌面窗口 / 瀏覽器」切換控件(iframe 系統不顯示) */
export function isModeToggleable(system: SystemLink): boolean {
    return system.openMode !== 'iframe'
}
