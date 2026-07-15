/**
 * project-flow feature 的 renderer 端類型。
 *
 * ⚠️ 專案/畫布/匯報/反饋/團隊功能已清退,只留備忘錄 + 首頁儀表板需要的型別。
 * 主類型直接 re-export 自跨進程共用 `@shared/types/project-flow.types`,
 * 確保 main / preload / renderer 三端 schema 一致。
 */

export type {
    MemoResponse,
    PagedResult,
    TodayActivityCategory,
    TodayActivitySummary,
    AiMemoSuggestion,
} from '@shared/types/project-flow.types'

/** project-flow.* SignalR 事件 envelope(對齊 main 推給 renderer 的格式;目前備忘窗未訂閱,保留給未來用) */
export interface ProjectFlowPushEvent {
    action: string
    payload: unknown
}
