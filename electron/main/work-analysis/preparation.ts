/**
 * 分析「準備階段」協調器 — 把 records 範圍轉成 Dialog 可顯示的 system / user prompt。
 *
 * 從 work-analysis.handlers.ts 抽出來,讓 handler 只做 IPC 協議翻譯,業務聚合留在 work-analysis/ 內。
 *
 * 編排步驟:
 *   1. listByRange    從 work_records 撈時段內紀錄
 *   2. read template  從 work_template_cache 拿 code → label 對照
 *   3. aggregate      → AnalysisInputPayload
 *   4. build prompts  套 locale 對應的 system + 把 payload 序列化成 user content
 *
 * 失敗 / 邊界:統一回 discriminated union,呼叫端(IPC handler)直接轉成 PrepareResult。
 */

import type {ConfigManager} from '../config-manager'
import type {WorkRecordService} from '../db/features/work-collect/service'
import type {WorkTemplateCacheService} from '../db/features/work-collect/template-cache.service'
import {aggregate, type AggregatorTemplate} from './aggregator'
import {buildUserContent, getSystemPrompt, type ReportLocale} from './prompt-builder'

export interface PrepareInput {
    rangeStart: number
    rangeEnd: number
    locale: ReportLocale
}

export type PrepareOutcome =
    | {
    ok: true
    systemPrompt: string
    userContent: string
    recordCount: number
}
    | { ok: false; kind: 'no-records' | 'db' }

export function prepareAnalysis(
    deps: {
        workRecordService: WorkRecordService | null
        templateCacheService: WorkTemplateCacheService | null
        configManager: ConfigManager
    },
    input: PrepareInput,
): PrepareOutcome {
    if (!deps.workRecordService) return {ok: false, kind: 'db'}

    const records = deps.workRecordService.listByRange(input.rangeStart, input.rangeEnd)
    if (records.length === 0) return {ok: false, kind: 'no-records'}

    const tplDetail = deps.templateCacheService?.read()
    const template: AggregatorTemplate = {
        name: tplDetail?.name ?? null,
        description: tplDetail?.description ?? null,
        labelByCode: (tplDetail?.items ?? []).reduce<Record<string, string>>((acc, it) => {
            if (it.code && it.label) acc[it.code] = it.label
            return acc
        }, {}),
    }
    const intervalMinutes = deps.configManager.getConfig().workCollect?.intervalMinutes ?? 5

    const inputPayload = aggregate(records, template, {
        intervalMinutes,
        rangeStart: input.rangeStart,
        rangeEnd: input.rangeEnd,
    })

    return {
        ok: true,
        systemPrompt: getSystemPrompt(input.locale),
        userContent: buildUserContent(inputPayload, input.locale),
        recordCount: records.length,
    }
}
