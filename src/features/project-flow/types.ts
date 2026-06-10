/**
 * project-flow feature 的 renderer 端類型。
 *
 * 主類型直接 re-export 自跨進程共用 `@shared/types/project-flow.types`,
 * 確保 main / preload / renderer 三端 schema 一致(docs/20 §6.1)。
 */

export type {
    ProjectListItem,
    ProjectDetailResponse,
    NodeResponse,
    EdgeResponse,
    ReportResponse,
    ReportSummaryItem,
    ReportItem as ReportItemResponse,
    MemoResponse,
    FeedbackResponse,
    AiQuotaInfo,
    NodeProgressItem as NodeProgressInfo,
    NodeLinkedReportItem,
    PagedResult,
    TeamSubordinateItem,
    MyNodeItem,
    EmployeeItem,
    TodayActivityCategory,
    AiReportAdvice,
    AiMemoSuggestion,
} from '@shared/types/project-flow.types'

/** 客戶端 viewport 狀態(只給畫布記錄,不上報後端) */
export interface CanvasViewport {
    zoom: number
    x: number
    y: number
}

/** project-flow.* SignalR 事件 envelope(對齊 main 推給 renderer 的格式) */
export interface ProjectFlowPushEvent {
    action: string
    payload: unknown
}
