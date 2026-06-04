/**
 * AI 報告 JSON 結構定義 + runtime 驗證(v3,加 reasoning + leverage)。
 *
 * Prompt-builder 對 LLM 講過結構,但 LLM 不一定 100% 守約 — 必須在落 DB 前 runtime 驗。
 * 輕量驗證,不拉 zod(對齊既有策略:淺層用 type guard,深巢狀才上 zod)。
 *
 * 驗證**失敗**時,呼叫端 fallback 到「raw text + warning」展示模式(對應 B4-選 2)。
 *
 * v3 變更:
 *   + reasoning[]:對應新 prompt「對不確定的地方要明確標註」要求 model 顯式給依據
 *   + leverage:L1-L5 槓桿率,對應新 prompt 主軸「幫員工提升工作槓桿率」
 *   + timeAllocation.verdict 加 'unclear' 列舉(資料樣本不足時不該硬下結論)
 */

/** 工作槓桿層級(對應 prompt 內 L1-L5) */
export type LeverageLevel = 'L1' | 'L2' | 'L3' | 'L4' | 'L5'

/** model 對「判斷信心」的自評,'unclear' = 明確標註「需補充上下文」 */
export type Confidence = 'high' | 'medium' | 'low' | 'unclear'

/** AI 回的完整報告結構 */
export interface AnalysisReportPayload {
    summary: string

    /**
     * 判斷依據陣列 — 每條 model 的判斷對應一個觀點 + 證據 + 信心。
     * 對應新 prompt「不要根據工具名稱直接判斷工作價值,必須根據描述推斷工作意圖、成果與可複用性。
     * 若無法判斷,請標記為『需補充上下文』」要求。
     */
    reasoning: Array<{
        point: string
        evidence: string
        confidence: Confidence
    }>

    timeAllocation: {
        verdict: 'balanced' | 'skewed-high' | 'skewed-low' | 'unclear'
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

    /**
     * 槓桿率評估(可選)— 樣本太少 / 無法判斷時 model 可回 null。
     * UI 拿到 null 時就不渲這個區塊,不算驗證失敗。
     */
    leverage: {
        currentLevel: LeverageLevel
        comment: string
    } | null

    tomorrowSuggestion: string
}

const LEVERAGE_LEVELS: ReadonlySet<string> = new Set(['L1', 'L2', 'L3', 'L4', 'L5'])
const CONFIDENCE_LEVELS: ReadonlySet<string> = new Set(['high', 'medium', 'low', 'unclear'])
const VERDICT_LEVELS: ReadonlySet<string> = new Set(['balanced', 'skewed-high', 'skewed-low', 'unclear'])

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

    if (!isReasoningArray(parsed.reasoning)) {
        return {ok: false, reason: 'reasoning 結構不符(需為陣列,每項含 point / evidence / confidence)'}
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

    if (!isLeverageOrNull(parsed.leverage)) {
        return {ok: false, reason: 'leverage 結構不符(需為 null 或 { currentLevel, comment })'}
    }

    if (!isNonEmptyString(parsed.tomorrowSuggestion)) {
        return {ok: false, reason: 'tomorrowSuggestion 缺失或非字串'}
    }

    return {ok: true, report: parsed as unknown as AnalysisReportPayload}
}

// ── 內部 type guards ──────────────────────────────────────────────

function isObject(v: unknown): v is Record<string, unknown> {
    return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isNonEmptyString(v: unknown): v is string {
    return typeof v === 'string' && v.length > 0
}

function isReasoningArray(v: unknown): boolean {
    if (!Array.isArray(v)) return false
    // 允許空陣列 — 樣本很少時 model 可能省略
    if (v.length > 10) return false  // 上限防 model 暴噴
    return v.every((it) =>
        isObject(it)
        && isNonEmptyString(it.point)
        && isNonEmptyString(it.evidence)
        && typeof it.confidence === 'string'
        && CONFIDENCE_LEVELS.has(it.confidence),
    )
}

function isTimeAllocation(v: unknown): boolean {
    if (!isObject(v)) return false
    if (typeof v.verdict !== 'string' || !VERDICT_LEVELS.has(v.verdict)) return false
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

function isLeverageOrNull(v: unknown): boolean {
    if (v === null) return true  // model 主動回 null 表示「無法評估」,合法
    if (!isObject(v)) return false
    if (typeof v.currentLevel !== 'string' || !LEVERAGE_LEVELS.has(v.currentLevel)) return false
    return isNonEmptyString(v.comment)
}
