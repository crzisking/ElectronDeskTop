/**
 * electronAPI.workCollect 子介面 — 工作自動採集。
 */

import type {WorkRecord, WorkResultPayload, WorkTemplateDetail} from '@/features/work-collect/types'

export interface WorkCollectAPI {
    /**
     * 切換採集開關。主進程會寫進 config 並啟停 scheduler。
     * @returns 切換後的 enabled 狀態
     */
    toggle: (enabled: boolean) => Promise<boolean>

    /**
     * 查詢採集紀錄,給流水線 UI 顯示用。
     * @param params since/until 用 Unix ms,半開區間 [since, until)
     * @returns 按時間升序的紀錄陣列
     */
    list: (params: { since: number; until: number }) => Promise<WorkRecord[]>

    /**
     * 把 AI 分析結果回送主進程,由 main handler 寫進 DB 並推 PUSH_WORK_RECORD_NEW。
     */
    sendResult: (payload: WorkResultPayload) => void

    // ─── 集中化(docs/20)新增 ──────────────────────────────────

    /**
     * 列出本地 synced=0 的紀錄,sync-daily 撈 unsynced 用。
     * limit 預設 200,跟 server 單請求上限對齊。
     */
    listUnsynced: (limit?: number) => Promise<WorkRecord[]>

    /**
     * 把指定 localIds 標記為已同步;syncedAt 用 server 返回的 ms。
     * 回 OpResult:ok=false 時 caller 可保留 unsynced 狀態待下次重試。
     */
    markSynced: (localIds: number[], syncedAt: number) => Promise<{ ok: boolean; reason?: string }>

    /**
     * server 拉回來的配置寫入本地 + 視變更重啟 scheduler。
     * @returns changed=true 表示配置實際有變(已套用 + restart),false=本地已是最新
     */
    applyRemoteConfig: (config: {
        enabled: boolean
        intervalMinutes: number
        workStartHour: number
        workEndHour: number
        version: number
        categoryTemplateId?: number | null
        templateName?: string | null
        /** 模板整份詳情;main 端落到 work_template_cache,給 tick 組 prompt 用 */
        templateDetail?: unknown
    }) => Promise<{ changed: boolean }>

    /**
     * Renderer bootstrap 完成的 ack。
     * Main 收到後會補推任何曾經失敗的 config/sync request(處理「main 早於 renderer ready」的競態)。
     */
    notifyReady: () => Promise<void>

    /**
     * sync 完成 ack。Main 據此清 pending(ok)或保留待重試(fail)。
     * 防止「事件已推但實際沒完成」的隱性故障。
     *
     * 註:採集健康狀態(待同步數 / 失敗計數)刻意不在主窗口暴露,
     * 只在密碼保護的日誌查看器(logViewerAPI.workHealth)可見。
     */
    syncDone: (result: { ok: boolean; synced?: number; failed?: number; error?: string }) => Promise<void>

    /**
     * 取本地模板 cache(沒 server config / 模板被解綁時回 null)。
     * renderer 拿來建 code → label 對照,給 UI 顯示分類中文名;不負責 prompt 組裝。
     */
    getTemplate: () => Promise<WorkTemplateDetail | null>
}
