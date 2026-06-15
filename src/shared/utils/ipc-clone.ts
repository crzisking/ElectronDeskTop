/**
 * 出境參數淨化 — Vue 的 reactive/ref 是 Proxy,Electron IPC 的 structured clone
 * 不能序列化 Proxy(報「An object could not be cloned」)。
 * 過 IPC 前先 JSON 走一圈轉成純物件(順帶剝掉 undefined / function)。
 */
export function plain<T>(obj: T): T {
    return JSON.parse(JSON.stringify(obj)) as T
}
