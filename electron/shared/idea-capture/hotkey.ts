/**
 * 靈感速記全域快捷鍵的純邏輯(docs/21 §3.2)。
 *
 * Electron accelerator 字串校驗 —— 註冊前先擋明顯不合法的,給使用者即時回饋,
 * 避免 globalShortcut.register 靜默失敗。純函式可單測。
 */

/** 預設熱鍵(CommandOrControl 跨平台;Windows = Ctrl) */
export const DEFAULT_HOTKEY = 'CommandOrControl+Shift+Space'

/** 允許的修飾鍵(Electron accelerator 規範) */
const MODIFIERS = new Set([
    'command', 'cmd', 'control', 'ctrl', 'commandorcontrol', 'cmdorctrl',
    'alt', 'option', 'altgr', 'shift', 'super', 'meta',
])

/** 允許的按鍵(單一;涵蓋常用) */
function isKeyToken(tok: string): boolean {
    const t = tok.toLowerCase()
    if (/^[a-z0-9]$/.test(t)) return true                       // 字母 / 數字
    if (/^f([1-9]|1[0-9]|2[0-4])$/.test(t)) return true         // F1~F24
    return [
        'space', 'tab', 'backspace', 'delete', 'insert', 'return', 'enter', 'escape', 'esc',
        'up', 'down', 'left', 'right', 'home', 'end', 'pageup', 'pagedown', 'plus',
        'printscreen', ',', '.', '/', ';', "'", '[', ']', '\\', '-', '=', '`',
    ].includes(t)
}

/**
 * 校驗一個 accelerator 字串:必須恰有一個「按鍵」,其餘皆為修飾鍵。
 * 建議至少帶一個修飾鍵(否則像 "Space" 這種會搶掉全域空白鍵),但不強制。
 */
export function isValidAccelerator(accel: string | undefined | null): boolean {
    if (!accel || !accel.trim()) return false
    const parts = accel.split('+').map((p) => p.trim()).filter(Boolean)
    if (parts.length === 0) return false

    let keyCount = 0
    for (const p of parts) {
        const low = p.toLowerCase()
        if (MODIFIERS.has(low)) continue
        if (isKeyToken(p)) {
            keyCount++
            continue
        }
        return false // 既不是修飾鍵也不是合法按鍵
    }
    return keyCount === 1
}

/** 正規化:去空白;不合法回預設熱鍵(給 config 讀取時兜底) */
export function normalizeHotkey(accel: string | undefined | null): string {
    const s = (accel ?? '').trim()
    return isValidAccelerator(s) ? s : DEFAULT_HOTKEY
}
