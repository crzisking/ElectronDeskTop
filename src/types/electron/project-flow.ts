/**
 * electronAPI.projectFlow 子介面 — 對齊 preload/bridges/project-flow.bridge.ts。
 * 每個 method 接 ctx + 業務 args,返回統一 {ok, data} | {ok, error} envelope。
 *
 * ⚠️ 專案/畫布/匯報/反饋/團隊功能已清退(公測前瘦身),只留備忘錄獨立窗需要的部分
 * + 首頁儀表板用的 listMyNodes/todayActivity。
 */

// userId = 工號;信封型別統一來自 @shared/types/ipc.types
import type {IpcCtx as Ctx, IpcResult as Result} from '@shared/types/ipc.types'

export interface ProjectFlowAPI {
    /** 跨項目「我的節點」(備忘 AI 建議的輸入) */
    listMyNodes: (ctx: Ctx) => Promise<Result<unknown>>
    /** 今日 work-collect 聚合(首頁儀表板用) */
    todayActivity: () => Promise<Result<unknown>>

    // Memos
    listMemos: (ctx: Ctx, query: object) => Promise<Result<unknown>>
    createMemo: (ctx: Ctx, body: object) => Promise<Result<{ memoId: number }>>
    updateMemo: (ctx: Ctx, memoId: number, body: object) => Promise<Result<unknown>>
    setMemoStatus: (ctx: Ctx, memoId: number, body: object) => Promise<Result<unknown>>
    deleteMemo: (ctx: Ctx, memoId: number) => Promise<Result<unknown>>

    /** AI 備忘建議 — 本地 LlmClient */
    aiMemoSuggest: (ctx: Ctx, body: object) => Promise<Result<unknown>>
}
