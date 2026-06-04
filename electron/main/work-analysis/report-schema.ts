/**
 * AI 報告 JSON 結構定義 + runtime 驗證。
 *
 * Prompt-builder 對 LLM 講過結構,但 LLM 不一定 100% 守約 — 必須在落 DB 前
 * runtime 驗一次。輕量驗證,不拉 zod(本檔只在 main 用,跟 IPC payload 那邊
 * 的策略一致:淺層用 type guard,深巢狀才上 zod)。
 *
 * 驗證**失敗**時,呼叫端會 fallback 到「raw text + warning」展示模式(對應使用者選擇 B4-選 2)。
 */

/** AI 回的完整報告結構 */
export interface AnalysisReportPayload {
    summary: string
    timeAllocation: {
        verdict: 'balanced' | 'skewed-high' | 'skewed-low'
        comment: string
    }
    highlights: Array<{
        title: string
        detail: string
    }>
    opportunities: Array<{
        title: string
        currentBehavior: string
        whyItMatters: string
        suggestion: string
    }>
    tomorrowSuggestion: string
}

/**
 * 嘗試 parse + 驗證 AI 回應字串。
 *
 * 流程:
 *   1. parse JSON(失敗回 null)
 *   2. 結構驗證(每個欄位 type / 必填 / array bounds)
 *   3. 回 { ok: true, report } 或 { ok: false, reason }
 *
 * caller 拿 { ok: false } 時,展示「raw text + warning」UI;reportJson 落 DB
 * 仍存 raw,讓使用者點報告時看到 AI 實際說了什麼。
 */
export function parseAndValidate(
    raw: string,
): { ok: true; report: AnalysisReportPayload } | { ok: false; reason: string } {
    let parsed: unknown
    try {
        parsed = JSON.parse(raw)
    } catch (err) {
        return {ok: false, reason: `JSON parse 失敗: ${(err as Error).message}`}
    }

    if (!isObject(parsed)) {
        return {ok: false, reason: '頂層不是 object'}
    }

    if (!isNonEmptyString(parsed.summary)) {
        return {ok: false, reason: 'summary 缺失或非字串'}
    }

    if (!isTimeAllocation(parsed.timeAllocation)) {
        return {ok: false, reason: 'timeAllocation 結構不符'}
    }

    if (!isHighlightArray(parsed.highlights)) {
        return {ok: false, reason: 'highlights 結構不符(需為長度 1-3 的陣列,每項含 title / detail)'}
    }

    if (!isOpportunityArray(parsed.opportunities)) {
        return {ok: false, reason: 'opportunities 結構不符(需為長度 1-3 的陣列,每項含 4 個必填欄位)'}
    }

    if (!isNonEmptyString(parsed.tomorrowSuggestion)) {
        return {ok: false, reason: 'tomorrowSuggestion 缺失或非字串'}
    }

    // 走完所有檢查 — 已知 parsed 結構符合 AnalysisReportPayload,cast 是安全的
    return {ok: true, report: parsed as unknown as AnalysisReportPayload}
}

// ── 內部 type guards ──────────────────────────────────────────────

function isObject(v: unknown): v is Record<string, unknown> {
    return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isNonEmptyString(v: unknown): v is string {
    return typeof v === 'string' && v.length > 0
}

function isTimeAllocation(v: unknown): boolean {
    if (!isObject(v)) return false
    if (v.verdict !== 'balanced' && v.verdict !== 'skewed-high' && v.verdict !== 'skewed-low') return false
    return isNonEmptyString(v.comment)
}

function isHighlightArray(v: unknown): boolean {
    if (!Array.isArray(v)) return false
    if (v.length < 1 || v.length > 3) return false
    return v.every((it) => isObject(it) && isNonEmptyString(it.title) && isNonEmptyString(it.detail))
}

function isOpportunityArray(v: unknown): boolean {
    if (!Array.isArray(v)) return false
    if (v.length < 1 || v.length > 3) return false
    return v.every((it) =>
        isObject(it)
        && isNonEmptyString(it.title)
        && isNonEmptyString(it.currentBehavior)
        && isNonEmptyString(it.whyItMatters)
        && isNonEmptyString(it.suggestion),
    )
}
