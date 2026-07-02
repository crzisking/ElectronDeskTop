/**
 * Agent v2 自動壓縮(auto-compaction)—— 對齊 opencode 的處理方式。
 *
 * opencode 不對「輪數」設硬上限:agent 一直跑到自然結束;當上下文用量逼近模型 context
 * 視窗時,把先前對話濃縮成一份摘要,之後只帶「摘要 + 摘要後的新訊息」繼續。
 *
 * 我們沒有 per-model 的 context 資料庫(不像 opencode 的 models.dev),故:
 *  - context 視窗大小做成可配置(AgentConfig.contextLimit)
 *  - 用量估計:優先用端點回報的 usage;拿不到就用字元數粗估(divisor 見下)
 *
 * 本檔只放**純函式**(估算 / 門檻判斷 / 提示詞),有副作用的摘要生成在 runtime。
 */

import type {AgentMessage} from '../../shared/types/agent.types'

/** 逼近 context 視窗的比例門檻:超過就壓縮(對齊 opencode 的 ~0.9) */
export const COMPACT_THRESHOLD = 0.9

/**
 * 粗估 token 數。1 token ≈ 3 字元(對中英混合偏保守 —— 寧可早一點壓縮,
 * 也不要估太少導致真的爆 context)。只在端點沒回報 usage 時當後備。
 */
export function estimateTokens(text: string | undefined | null): number {
    if (!text) return 0
    return Math.ceil(text.length / 3)
}

/** 估算一批訊息行的 token 量(content + reasoning) */
export function estimateRowsTokens(rows: AgentMessage[]): number {
    let sum = 0
    for (const r of rows) sum += estimateTokens(r.content) + estimateTokens(r.reasoningContent)
    return sum
}

/**
 * 從 AI SDK 的 usage 物件讀「輸入(prompt)token」數。相容 v7(inputTokens)與舊命名
 * (promptTokens)。讀不到回 0(交給字元估計後備)。
 */
export function usageInputTokens(usage: unknown): number {
    if (!usage || typeof usage !== 'object') return 0
    const u = usage as Record<string, unknown>
    const v = u.inputTokens ?? u.promptTokens
    return typeof v === 'number' && v > 0 ? v : 0
}

/** 用量是否已達壓縮門檻。contextLimit ≤ 0 視為不啟用 → 永不壓縮。 */
export function shouldCompact(usedTokens: number, contextLimit: number, threshold = COMPACT_THRESHOLD): boolean {
    if (contextLimit <= 0) return false
    return usedTokens >= contextLimit * threshold
}

/** 摘要生成用的 system 提示(要 LLM 產出「能無縫接續對話」的技術性摘要) */
export const SUMMARY_SYSTEM_PROMPT =
    '你是一個對話壓縮器。請把使用者提供的對話歷史濃縮成一份「詳盡但精簡」的摘要,' +
    '讓後續對話能無縫接續。務必保留:使用者的原始目標與需求、已完成/進行中的工作、' +
    '關鍵決策與其理由、涉及的檔案路徑/函式/指令、尚未解決的問題與下一步。' +
    '用條列式,只輸出摘要本身,不要客套或多餘說明。'

/** 附在對話歷史後、要求產生摘要的指令 */
export const COMPACT_INSTRUCTION = '請依系統指示,把以上完整對話濃縮成一份摘要。'

/** 摘要注入下一輪時的前綴(讓模型知道這是先前對話的濃縮上下文) */
export function summaryContextPrefix(summaryText: string): string {
    return `以下是先前對話的摘要,作為上下文參考(不是使用者的新訊息):\n\n${summaryText}`
}
