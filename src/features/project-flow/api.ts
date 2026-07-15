/**
 * project-flow renderer ↔ main 的 API 包裝層。
 *
 * ⚠️ 專案/畫布/匯報/反饋/團隊功能已清退(公測前瘦身),只留備忘錄獨立窗 + 首頁儀表板需要的方法。
 *
 * 不直接走 HTTP — 全部透過 window.electronAPI.projectFlow.* 走 IPC,由 main 進程
 * 統一帶 baseUrl + JWT 打後端,renderer 不接觸 token(對齊架構文件 §內存 token)。
 *
 * 每個 method 解 envelope:{ok:true, data} 直接回 data, {ok:false, error} 拋例外。
 * Store 層只需要 try/catch,不必反覆 if (ok)。
 */

import {useAuthStore} from '@/stores/auth.store'
import {plain} from '@/shared/utils/ipc-clone'
import {unwrapIpc as unwrap} from '@/shared/utils/ipc'
import {BACKEND_BASE_URL} from '@/shared/config/backend'
import type {MemoResponse, PagedResult, TodayActivitySummary} from './types'

/**
 * 從 authStore 取 ctx。後端 ProjectFlowController 已 [AllowAnonymous],身分靠 userId(工號)寫進 query;
 * token 預留(其他 controller 可能仍校驗)。
 */
function ctx(): { baseUrl: string; userId: string; token: string } {
    const auth = useAuthStore()
    return {
        baseUrl: BACKEND_BASE_URL,
        userId: auth.userName,
        token: auth.accessToken ?? '',
    }
}

const pf = () => window.electronAPI.projectFlow

export const projectFlowApi = {
    /** 今日 work-collect 摘要(類別 + 24h 熱力;唯讀參考,純本地不打後端) */
    todayActivity: () => unwrap<TodayActivitySummary>(pf().todayActivity()),

    // ── Memos ──
    listMemos: (query: object = {}) =>
        unwrap<PagedResult<MemoResponse[]>>(pf().listMemos(ctx(), plain(query))),
    createMemo: (body: object) => unwrap<{ memoId: number }>(pf().createMemo(ctx(), plain(body))),
    updateMemo: (id: number, body: object) => unwrap<void>(pf().updateMemo(ctx(), id, plain(body))),
    setMemoStatus: (id: number, body: object) => unwrap<void>(pf().setMemoStatus(ctx(), id, plain(body))),
    deleteMemo: (id: number) => unwrap<void>(pf().deleteMemo(ctx(), id)),

    // 本地 AI(教練模式):建議不代寫
    aiMemoSuggest: (body: object) =>
        unwrap<{ suggestions: { title: string; description?: string; priority?: number; reasoning?: string }[] }>(
            pf().aiMemoSuggest(ctx(), plain(body))),
}
