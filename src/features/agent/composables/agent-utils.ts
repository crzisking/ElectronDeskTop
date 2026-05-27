/**
 * Agent composable 共用 helpers。
 *
 * 純函式,跨 useAgentChat / useAgentStream / useAgentTools 共用。
 * 行為 100% 對齊原 useAgentChat.ts 內的同名 helper(§1.7 拆分搬出來,沒改邏輯)。
 */

/** 餵給 LLM 的內容截斷上限(避免 context 爆炸,對齊設計文檔 §6.2) */
export const MAX_TOOL_CONTENT_FOR_LLM = 4000

/** 流空閒看門狗:90 秒沒有 chunk 進來就 abort,觸發重試 */
export const STREAM_IDLE_TIMEOUT_MS = 90_000

/** 字串截斷 + 標記原長度;主要用於工具結果餵 LLM 前的瘦身 */
export function truncate(s: string, max: number): string {
    if (s.length <= max) return s
    return s.slice(0, max) + `\n...(截斷,原長度 ${s.length})`
}

/**
 * 工具結果在訊息卡片內展示用的短預覽(完整內容仍餵 LLM)。
 * screenshot 例外:dataURL 不截,讓 UI 直接 <img> 渲染。
 */
export function previewFor(name: string, content: string): string {
    if (name === 'screenshot' && content.startsWith('data:image')) {
        return content
    }
    return content.length > 400 ? content.slice(0, 400) + '…' : content
}
