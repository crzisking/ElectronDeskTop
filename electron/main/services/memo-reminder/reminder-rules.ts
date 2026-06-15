/**
 * 備忘到期提醒的「純時間規則」—— 從 scheduler 抽出,方便單元測試。
 * 只判斷「以現在時刻看,這條到期時間屬於哪種提醒狀態」,不含去重 / 上限等實例狀態。
 */

const DUE_SOON_MS = 24 * 3600_000
const STALE_OVERDUE_MS = 3 * 86_400_000

/** null = 不該提醒;'overdue' = 已逾期(3 天內);'due-soon' = 24 小時內到期 */
export type ReminderState = 'overdue' | 'due-soon'

/**
 * 純時間判斷:這條到期時間此刻屬於哪種提醒狀態,不需要提醒回 null。
 *   - 沒有到期日 → null
 *   - 已逾期且在 3 天內 → 'overdue'(逾期超過 3 天的舊賬不再吵)
 *   - 未來 24 小時內到期 → 'due-soon'
 *   - 更遠的未來 → null(還不用提醒)
 */
export function reminderState(dueDate: number | null | undefined, now: number): ReminderState | null {
    if (!dueDate) return null
    const diff = dueDate - now
    if (diff <= 0) return -diff <= STALE_OVERDUE_MS ? 'overdue' : null
    return diff <= DUE_SOON_MS ? 'due-soon' : null
}
