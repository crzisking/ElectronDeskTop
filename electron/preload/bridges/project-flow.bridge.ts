/**
 * ProjectFlow bridge — desktop renderer 對後端 tmbom /api/projectflow/* 的入口。
 *
 * ⚠️ 專案/畫布/匯報/反饋/團隊功能已清退,只留備忘錄獨立窗需要的部分。
 *
 * ctx 內含 baseUrl / userId(工號)+ 預留 token;由 renderer 從 authStore 拿。
 * 後端 [AllowAnonymous] 不校驗 JWT,只看 query 上的 userId。
 * 統一回 {ok: true, data} | {ok: false, error}(對齊 IPC handler safeRun 包裝)。
 */
import type {IpcRenderer} from 'electron'
// 型別 import 編譯期擦除,sandbox preload 不會因此產生 chunk
import type {IpcCtx as Ctx, IpcResult as Result} from '@shared/types/ipc.types'

export interface ProjectFlowChannelMap {
    [key: string]: string
}

export function createProjectFlowBridge(ipc: IpcRenderer, ch: ProjectFlowChannelMap) {
    const c = (action: string, args: object = {}) => ipc.invoke(action, args)

    return {
        todayActivity: () =>
            c(ch.PROJECT_FLOW_TODAY_ACTIVITY, {}) as Promise<Result<unknown>>,

        // Memos
        listMemos: (ctx: Ctx, query: object) =>
            c(ch.PROJECT_FLOW_LIST_MEMOS, {ctx, query}) as Promise<Result<unknown>>,
        createMemo: (ctx: Ctx, body: object) =>
            c(ch.PROJECT_FLOW_CREATE_MEMO, {ctx, body}) as Promise<Result<{ memoId: number }>>,
        updateMemo: (ctx: Ctx, memoId: number, body: object) =>
            c(ch.PROJECT_FLOW_UPDATE_MEMO, {ctx, memoId, body}) as Promise<Result<unknown>>,
        setMemoStatus: (ctx: Ctx, memoId: number, body: object) =>
            c(ch.PROJECT_FLOW_SET_MEMO_STATUS, {ctx, memoId, body}) as Promise<Result<unknown>>,
        deleteMemo: (ctx: Ctx, memoId: number) =>
            c(ch.PROJECT_FLOW_DELETE_MEMO, {ctx, memoId}) as Promise<Result<unknown>>,

        // AI local — 教練模式:回建議,不代寫
        aiMemoSuggest: (ctx: Ctx, body: object) =>
            c(ch.PROJECT_FLOW_AI_MEMO_SUGGEST, {ctx, body}) as Promise<Result<unknown>>,
    }
}
