/**
 * 北京時間工具(UTC+8 無 DST,直接 +8h 偏移)。
 *
 * 不引入 date-fns-tz / moment-timezone —— 北京不切 DST,純加法即可,
 * 跨語言保持簡單。
 */

export function getBeijingHour(): number {
    return (new Date().getUTCHours() + 8) % 24
}

export function getBeijingDate(): string {
    const b = new Date(Date.now() + 8 * 3600_000)
    const p = (n: number) => String(n).padStart(2, '0')
    return `${b.getUTCFullYear()}-${p(b.getUTCMonth() + 1)}-${p(b.getUTCDate())}`
}
