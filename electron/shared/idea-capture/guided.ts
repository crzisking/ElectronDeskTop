/**
 * 靈感速記「引導式三段結構」的純邏輯(docs/21 §2)。
 *
 * 不給空白框,用「問題」引導使用者把重要的寫出來;問題隨想法類型切換。
 * 這裡全是純函式(引導文案 / 校驗 / 軟提醒 / 標籤正規化),UI 與 IPC 都用同一份,可單測。
 */

import type {IdeaCreateMeta, IdeaType} from '../types/idea-capture.types'

/** 一個類型對應的引導文案:欄位問題 + 具體例句(placeholder) */
export interface GuideText {
    /** 類型顯示名 */
    label: string
    /** 第 1 欄(想法本體)的 placeholder 例句 */
    contentEg: string
    /** 第 2 欄問題 + 例句 */
    sceneQ: string
    sceneEg: string
    /** 第 3 欄問題 + 例句 */
    expectQ: string
    expectEg: string
}

/** 引導文案隨類型切換(docs/21 §2 的表) */
export const GUIDE_BY_TYPE: Record<IdeaType, GuideText> = {
    improve: {
        label: '改進點',
        contentEg: '例:BOM 匯入的重複料號可以自動合併',
        sceneQ: '現在的痛點是?',
        sceneEg: '例:每次匯入都要手動排查,半小時起步',
        expectQ: '期望改成怎樣?',
        expectEg: '例:匯入時自動提示合併,點一下確認',
    },
    issue: {
        label: '問題',
        contentEg: '例:報表匯出偶爾會少幾筆資料',
        sceneQ: '怎麼發生的(能重現嗎)?',
        sceneEg: '例:資料量大於 5000 筆時偶發,不一定重現',
        expectQ: '影響多大 / 多急?',
        expectEg: '例:財務對帳受影響,本週要處理',
    },
    inspiration: {
        label: '靈感',
        contentEg: '例:可以用 AI 幫忙自動歸類工單',
        sceneQ: '由什麼觸發的?',
        sceneEg: '例:看到客服每天手動分類工單',
        expectQ: '可以用在哪?',
        expectEg: '例:報修系統的工單自動派工',
    },
    todo: {
        label: '待辦',
        contentEg: '例:整理上季度的設備維護記錄',
        sceneQ: '為什麼現在記下來?',
        sceneEg: '例:下次稽核會用到',
        expectQ: '期限 / 優先級?',
        expectEg: '例:月底前,中優先',
    },
}

export const IDEA_TYPES: IdeaType[] = ['improve', 'issue', 'inspiration', 'todo']

/** 取某類型的引導文案(未知類型退回 improve) */
export function guideFor(type: IdeaType): GuideText {
    return GUIDE_BY_TYPE[type] ?? GUIDE_BY_TYPE.improve
}

export interface ValidationResult {
    ok: boolean
    error?: string
}

/**
 * 保存前的硬校驗(擋不合法,阻塞保存)。
 * 唯一必填是想法本體;其餘是軟提醒(見 softWarn)。
 */
export function validateCreate(meta: Pick<IdeaCreateMeta, 'content' | 'ideaType' | 'visibility'>): ValidationResult {
    if (!meta.content || !meta.content.trim()) return {ok: false, error: '想法內容不可為空'}
    if (meta.content.trim().length > 5000) return {ok: false, error: '想法內容過長(上限 5000 字)'}
    if (!IDEA_TYPES.includes(meta.ideaType)) return {ok: false, error: '想法類型不合法'}
    if (meta.visibility !== 'private' && meta.visibility !== 'dept') return {ok: false, error: '可見範圍不合法'}
    return {ok: true}
}

/**
 * 軟提醒(不阻塞保存):場景空 → 提醒補一句以後更好回憶。
 * 回 null 表沒什麼要提醒;回字串則顯示在保存鈕旁,使用者再按一次照存。
 */
export function softWarn(meta: Pick<IdeaCreateMeta, 'scene'>): string | null {
    if (!meta.scene || !meta.scene.trim()) return '補一句場景,以後更好回憶'
    return null
}

/**
 * 標籤正規化:切分(逗號 / 頓號 / 空白 / 分號)、trim、去空、去重(保序,大小寫不敏感去重)。
 * 接受字串或字串陣列。
 */
export function normalizeTags(input: string | string[] | undefined | null): string[] {
    if (!input) return []
    const raw = Array.isArray(input) ? input : input.split(/[,，、;；\s]+/)
    const out: string[] = []
    const seen = new Set<string>()
    for (const t of raw) {
        const tag = (t ?? '').trim()
        if (!tag) continue
        const key = tag.toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        out.push(tag)
    }
    return out
}

/**
 * 解析想法庫搜尋框的 tag 語法。
 *  - "tag:ERP" → "ERP"
 *  - "  tag: MES " → "MES"
 *  - 沒有 tag: 前綴 → null(交給一般關鍵字搜尋)
 */
export function parseTagQuery(input: string | undefined | null): string | null {
    if (!input) return null
    const m = input.trim().match(/^tag:\s*(.+)$/i)
    return m ? m[1].trim() || null : null
}
