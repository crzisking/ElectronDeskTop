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

/** 相對時間:剛剛 / N分鐘前 / N小時前 / N天前(≥7 天回退到 formatDate) */
export function formatRelative(ms?: number | null): string {
    if (!ms) return ''
    const m = Math.floor((Date.now() - ms) / 60000)
    if (m < 1) return '剛剛'
    if (m < 60) return `${m} 分鐘前`
    const h = Math.floor(m / 60)
    if (h < 24) return `${h} 小時前`
    const d = Math.floor(h / 24)
    return d < 7 ? `${d} 天前` : formatDate(ms)
}

/** 檔名安全時間戳:「YYYYMMDD_HHmmss」(匯出檔名用) */
export function formatStamp(ms?: number | null): string {
    const d = ms ? new Date(ms) : new Date()
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}
