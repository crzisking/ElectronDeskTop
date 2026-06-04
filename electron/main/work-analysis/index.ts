/**
 * 工作分析子系統 barrel — 對外只暴露三個入口。
 *
 * 設計:跟 work-collect 目錄並列,但職責清楚分:
 *   work-collect/ ─── 採集流水線(scheduler / capture / sync)
 *   work-analysis/ ── 分析報告(aggregator / prompt / schema)
 */

export {aggregate} from './aggregator'
export type {
    AnalysisInputPayload,
    CategorySlice,
    HourlyDominant,
    AppRank,
    RepetitivePattern,
    AggregatorTemplate,
    AggregateOptions,
} from './aggregator'

export {
    buildMessages,
    buildMessagesFromText,
    getSystemPrompt,
    buildUserContent,
} from './prompt-builder'
export type {ReportLocale} from './prompt-builder'

export {parseAndValidate} from './report-schema'
export type {AnalysisReportPayload} from './report-schema'

export {workAnalysisRunContext} from './run-context'
export type {RunHandle} from './run-context'
