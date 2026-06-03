/**
 * IPC payload 共用 runtime guards。
 *
 * 為什麼存在:
 *   IPC 邊界跨進程,payload 是 `unknown`。zod 適合複雜巢狀(見 agent.handlers),
 *   但「拿一個 number 是不是正整數」這種事不該要求 schema。本檔提供 primitive 級
 *   guards,給「shape 簡單、不值得拉 zod schema」的 handler 用,避免每個檔重寫一份。
 *
 * 慣例:
 *   - 巢狀 / 多欄位 / discriminated union → 用 zod(像 agent.handlers.ts)
 *   - 單一 primitive / 淺層 ≤ 2 欄物件     → 用本檔的 guards
 *
 * 函式都是型別守衛(`v is T`),caller 可在 if 後直接享受 narrow,不必再 cast。
 */

/** 正整數(> 0, integer) */
export function isPositiveInt(v: unknown): v is number {
    return typeof v === 'number' && Number.isInteger(v) && v > 0
}

/** 非負有限數(>= 0, finite,允許小數) */
export function isNonNegativeNumber(v: unknown): v is number {
    return typeof v === 'number' && Number.isFinite(v) && v >= 0
}

/** 整數區間 [min, max] */
export function isIntInRange(v: unknown, min: number, max: number): v is number {
    return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max
}

/** 非空字串(去頭尾空白後仍有字元),可選最大長度 */
export function isNonEmptyString(v: unknown, maxLen?: number): v is string {
    if (typeof v !== 'string') return false
    if (v.length === 0) return false
    return maxLen === undefined || v.length <= maxLen
}

/** 16 字元 hex(雜湊用,例:dHash) */
export function isHex16(v: unknown): v is string {
    return typeof v === 'string' && /^[0-9a-fA-F]{16}$/.test(v)
}

/** 陣列且每個元素都通過 itemGuard */
export function isArrayOf<T>(v: unknown, itemGuard: (x: unknown) => x is T): v is T[] {
    return Array.isArray(v) && v.every(itemGuard)
}
