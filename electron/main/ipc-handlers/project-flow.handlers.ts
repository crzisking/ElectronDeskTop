/**
 * 項目流程 IPC handler(docs/20)— 純通道註冊層。
 *
 * ⚠️ 專案/畫布/匯報/反饋/團隊功能已清退(公測前瘦身),只留備忘錄獨立窗需要的部分
 * + 首頁儀表板用的「今日活動」。
 *
 * 模式跟 work-collect.handlers.ts 同:
 *   - renderer invoke 帶 {ctx: {baseUrl, userId, token}, ...args}
 *   - handler 呼叫 projectFlowApi(轉 fetch 給 tmbom 後端)
 *   - 失敗統一回 {ok:false, error}
 *
 * 業務邏輯不放這裡:
 *   - HTTP 轉發 → services/project-flow/api-client.ts
 *   - 本地 AI(備忘建議)→ services/project-flow/ai-local.ts
 *
 * 為什麼 renderer 不直接打後端:統一在主進程做請求,未來加 retry / cache / 離線降級集中一處。
 */

import {ipcMain} from 'electron'
import {IpcChannels} from '../../shared/ipc-channels'
import {projectFlowApi, type ProjectFlowApiContext} from '../services/project-flow/api-client'
import {generateMemoSuggestions, summarizeTodayActivityFromService} from '../services/project-flow/ai-local'
import {authContext} from '../services/auth-context'
import type {LlmClient} from '../services/llm'
import type {WorkRecordService} from '../db/features/work-collect/service'

/** 註冊 handler 時注入的相依;AI 本地端點要用 */
interface ProjectFlowHandlerDeps {
    llmClient: LlmClient | null
    workRecordService: WorkRecordService | null
}

/** invoke payload 統一形狀:第一個欄位放 ctx,其餘是業務參數 */
interface InvokePayload {
    ctx?: ProjectFlowApiContext
    [key: string]: unknown
}

function getCtx(payload: InvokePayload | undefined): ProjectFlowApiContext | null {
    // 主窗顯式傳 ctx → 採用;子視窗(Memos / LogViewer)沒帶 ctx → 走主進程 authContext
    if (payload?.ctx?.baseUrl && payload?.ctx?.userId) return payload.ctx
    const a = authContext.get()
    if (!a.userId) return null
    return {baseUrl: a.baseUrl, userId: a.userId, token: a.token}
}

/** 統一錯誤包裝 — handler 回 result 物件,不擴散異常給 renderer */
async function safeRun<T>(fn: () => Promise<T>): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
    try {
        return {ok: true, data: await fn()}
    } catch (err) {
        return {ok: false, error: err instanceof Error ? err.message : String(err)}
    }
}

/**
 * 樣板收斂:取 ctx → 失敗回 missing ctx → safeRun 包業務呼叫。
 */
function handleWithCtx(
    channel: string,
    fn: (ctx: ProjectFlowApiContext, p: InvokePayload) => Promise<unknown>,
): void {
    ipcMain.handle(channel, async (_e, p: InvokePayload) => {
        const ctx = getCtx(p)
        if (!ctx) return {ok: false, error: 'missing ctx'}
        return safeRun(() => fn(ctx, p))
    })
}

export function registerProjectFlowHandlers(
    deps: ProjectFlowHandlerDeps = {llmClient: null, workRecordService: null},
): void {
    const ch = IpcChannels
    const api = projectFlowApi

    // 今日活動摘要 — 純本地讀 work-collect,不打後端(首頁儀表板用)
    ipcMain.handle(ch.PROJECT_FLOW_TODAY_ACTIVITY, async () =>
        safeRun(async () => {
            if (!deps.workRecordService) throw new Error('工作採集服務未就緒')
            return summarizeTodayActivityFromService(deps.workRecordService)
        }))

    // ── Memos ───────────────────────────────────────────────
    handleWithCtx(ch.PROJECT_FLOW_LIST_MEMOS, (ctx, p) => api.listMemos(ctx, (p.query as object) ?? {}))
    handleWithCtx(ch.PROJECT_FLOW_CREATE_MEMO, (ctx, p) => api.createMemo(ctx, p.body))
    handleWithCtx(ch.PROJECT_FLOW_UPDATE_MEMO, (ctx, p) => api.updateMemo(ctx, p.memoId as number, p.body))
    handleWithCtx(ch.PROJECT_FLOW_SET_MEMO_STATUS, (ctx, p) => api.setMemoStatus(ctx, p.memoId as number, p.body))
    handleWithCtx(ch.PROJECT_FLOW_DELETE_MEMO, (ctx, p) => api.deleteMemo(ctx, p.memoId as number))

    // ── AI 本地(備忘建議)— 走本地 LlmClient,不消耗後端配額 ──
    ipcMain.handle(ch.PROJECT_FLOW_AI_MEMO_SUGGEST, async (_e, p: InvokePayload) =>
        safeRun(() => generateMemoSuggestions(deps.llmClient, (p?.body as object) ?? {})))
}
