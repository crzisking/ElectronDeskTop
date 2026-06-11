/**
 * 時間格式化共用 — 取代各 view 自寫的 formatTime(曾在 7 個檔案各一份、格式還不一致)。
 * 約定:列表/詳情用 formatDateTime;緊湊場景(卡片角落)用 formatShortTime;日期欄用 formatDate。
 */

const pad = (n: number) => String(n).padStart(2, '0')

/** 完整時間:本地化的「日期 + 時間」(列表欄位用) */
export function formatDateTime(ms?: number | null): string {
    return ms ? new Date(ms).toLocaleString() : '-'
}

/** 緊湊時間:「M/D HH:mm」(卡片角落、聊天式列表用) */
export function formatShortTime(ms?: number | null): string {
    if (!ms) return ''
    const d = new Date(ms)
    return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 日期:「YYYY-MM-DD」 */
export function formatDate(ms?: number | null): string {
    if (!ms) return ''
    const d = new Date(ms)
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** 時刻:「HH:mm」 */
export function formatClock(ms?: number | null): string {
    if (!ms) return ''
    const d = new Date(ms)
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}
