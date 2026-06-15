/**
 * 首頁儀表板的純計算 — 從 HomeView.vue 抽出,不依賴 Vue ref / i18n / DOM,可單測。
 *
 * HomeView 只負責把這些結果接到模板 + i18n 文案;閾值、配色、到期判斷這類「容易改錯」
 * 的邏輯集中在這裡,被 tests/views/dashboard-utils.test.ts 釘死。
 */

const DAY = 86_400_000

/**
 * 工作節奏等級(用質性描述取代裸時長):
 *   0 蓄勢待發(沒工作)/ 1 剛起步(<1h)/ 2 漸入佳境(1~4h)/ 3 火力全開(≥4h)
 * HomeView 用回傳值拼 i18n key(home.pace0 ~ home.pace3)。
 */
export function paceLevel(minutes: number): 0 | 1 | 2 | 3 {
    if (minutes <= 0) return 0
    if (minutes < 60) return 1
    if (minutes < 240) return 2
    return 3
}

/** 類別佔比文字(四捨五入整數百分比);total 為 0 也不崩(除零保護回 0%) */
export function distPercent(part: number, total: number): string {
    return `${Math.round((part / Math.max(1, total)) * 100)}%`
}

/**
 * 熱力格背景:分鐘數 → 藍色深淺。0 給淡灰;1~60 線性加深,alpha 0.25→1.00。
 * minutes 封頂 60(上游 hourly 本就 cap 60,這裡再保險,避免 alpha 溢出 >1 產生非法 rgba)。
 */
export function heatStyle(minutes: number): { background: string } {
    if (minutes <= 0) return {background: '#eef1f6'}
    const capped = Math.min(60, minutes)
    const alpha = 0.25 + (capped / 60) * 0.75
    return {background: `rgba(48, 90, 158, ${alpha.toFixed(2)})`}
}

/** 到期顏色等級:none 無期限 / overdue 逾期 / soon 24h 內 / normal 其餘 */
export function dueLevel(due: number | null | undefined, now: number): 'none' | 'overdue' | 'soon' | 'normal' {
    if (!due) return 'none'
    const diff = due - now
    if (diff < 0) return 'overdue'
    if (diff <= DAY) return 'soon'
    return 'normal'
}

/**
 * 到期天數,按「日曆日」算(把 due 與 now 都歸零到當天 00:00 再相減):
 *   今天稍晚到期 → 0(不是「不到 1 天後」湊成 1);明天 → 1;昨天 → -1。
 * 無到期日回 null。比「ceil(毫秒差/天)」更符合直覺(後者會把今天傍晚的截止顯示成 1 天後)。
 */
export function dueDays(due: number | null | undefined, now: number): number | null {
    if (!due) return null
    const startOf = (ms: number): number => {
        const d = new Date(ms)
        d.setHours(0, 0, 0, 0)
        return d.getTime()
    }
    return Math.round((startOf(due) - startOf(now)) / DAY)
}
