/**
 * 靈感速記後台 AI 完善的純邏輯(docs/21 §「AI 完善」)。
 *
 * buildRefinePrompt:依想法三段 + 類型組出 system/user 提示,要 LLM 回 JSON。
 * parseRefineResult:容錯解析 LLM 輸出(可能夾 markdown ```json 圍欄)成結構化結果。
 * 兩者皆純函式 → refiner(main)組裝呼叫,可單測不碰 LLM。
 */

import type {IdeaAiResult, IdeaType} from '../types/idea-capture.types'
import {guideFor} from './guided'

/** 送去完善的想法快照(refiner 從後端 detail 取) */
export interface RefineInput {
    ideaType: IdeaType
    content: string
    scene?: string
    expectation?: string
}

export interface RefinePrompt {
    system: string
    user: string
}

const SYSTEM = [
    '你是一個「想法完善器」。使用者用三段結構速記了一個想法(想法本體 / 場景 / 期望),',
    '你要在**不脫離原意**的前提下把它整理得更清楚、更可行,方便日後回顧。',
    '嚴格要求:',
    '1. 只依使用者寫的內容完善,**不要編造**事實;資訊不足處寫進 questions,不要自己補。',
    '2. 只輸出一個 JSON 物件,不要任何多餘文字或 markdown 圍欄。',
    'JSON 結構:',
    '{',
    '  "title": "一句話標題(≤30字)",',
    '  "polishedText": "整合三段後的清楚版本(繁體中文)",',
    '  "actionItems": ["可執行的下一步", "..."],',
    '  "questions": ["影響回顧理解的待確認點", "..."],',
    '  "tags": ["領域標籤如 ERP/MES/SQL/UI", "..."]',
    '}',
    'actionItems / questions / tags 沒有就給空陣列。tags 2~4 個,精簡。',
].join('\n')

/** 組完善提示 */
export function buildRefinePrompt(idea: RefineInput): RefinePrompt {
    const g = guideFor(idea.ideaType)
    const user = [
        `想法類型:${g.label}`,
        `想法本體:${idea.content?.trim() || '(空)'}`,
        `場景/痛點:${idea.scene?.trim() || '(未填)'}`,
        `期望/下一步:${idea.expectation?.trim() || '(未填)'}`,
    ].join('\n')
    return {system: SYSTEM, user}
}

/**
 * 容錯解析 LLM 輸出。剝掉可能的 ```json 圍欄 + 抓第一個 {...};
 * 解析失敗回 null(refiner 據此標 failed)。
 */
export function parseRefineResult(raw: string | undefined | null): IdeaAiResult | null {
    if (!raw) return null
    const json = extractJson(raw)
    if (!json) return null
    try {
        const obj = JSON.parse(json) as Record<string, unknown>
        return {
            title: str(obj.title) || undefined,
            polishedText: str(obj.polishedText) || undefined,
            actionItems: strArray(obj.actionItems),
            aiQuestions: strArray(obj.questions),
            tags: strArray(obj.tags),
        }
    } catch {
        return null
    }
}

/** 從可能夾雜文字 / markdown 圍欄的字串裡抽出 JSON 物件片段 */
function extractJson(raw: string): string | null {
    const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
    const body = fence ? fence[1] : raw
    const start = body.indexOf('{')
    const end = body.lastIndexOf('}')
    if (start < 0 || end <= start) return null
    return body.slice(start, end + 1)
}

function str(v: unknown): string {
    return typeof v === 'string' ? v.trim() : ''
}

function strArray(v: unknown): string[] {
    if (!Array.isArray(v)) return []
    return v.map((x) => (typeof x === 'string' ? x.trim() : '')).filter((x) => x.length > 0)
}
