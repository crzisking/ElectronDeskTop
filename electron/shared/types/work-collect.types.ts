/**
 * 工作採集 — IPC payload 型別。
 *
 * main / preload / renderer 三處共享(docs/24 §7.2)。
 * 之前同樣的 interface 在三處各寫一遍,任何欄位變動容易漂移;集中此處後改一處到處生效。
 */

/**
 * AI 分析結果回送 main(IpcChannels.WORK_COLLECT_RESULT)。
 * category 是模板 code 字串(BOM_MAINT / OTHER 等),非寫死 union。
 */
export interface WorkResultPayload {
    capturedAt: number
    activeApp: string | null
    activeWindowTitle: string | null
    category: string
    description: string
    confidence: number
    /** dHash,從 tick payload 透傳 */
    screenshotHash: string | null
    /** AI 分類理由,可空 */
    reason: string | null
}

/**
 * sync 啟動 payload(renderer → main)。
 *
 * 為什麼帶 token / baseUrl:HTTP client + auth 原本只在 renderer(token 政策上不持久化到磁盤),
 * 集中化 sync 後 main 自己發 HTTP,token 仍只活在 main process 記憶體內(跟 renderer 同等待遇),
 * 不寫 DB / 不寫 disk。app 結束即丟。
 */
export interface WorkSyncRunPayload {
    userName: string
    /** JWT access token,僅 in-memory 用於本次 sync 的 Authorization header */
    token: string
    /** 後端 base URL(對齊渲染端 VITE_WORK_COLLECT_API_URL,由 renderer 注入避免 main 讀 vite env) */
    baseUrl: string
}

/** sync 結束 main 回給 renderer 的總結;主要供 log + UI 提示 */
export interface WorkSyncRunResult {
    ok: boolean
    synced: number
    failed: number
    /** 觸發單次輪數上限即 true;此時 ok 也會被設 false */
    hitLimit: boolean
    /** 失敗原因(僅 ok=false 時可能有值) */
    error?: string
}

/**
 * server my-config 拉回來的 config + 模板詳情 → main(IpcChannels.WORK_COLLECT_APPLY_REMOTE_CONFIG)。
 * main 端落 KV + work_template_cache,並視變更重啟 scheduler。
 *
 * templateDetail 結構故意打 unknown:三方都不關心內部 shape,
 * main 在 template-cache.service.ts 內 narrow 成 CachedTemplateDetail 後落地。
 */
export interface RemoteConfigPayload {
    enabled: boolean
    intervalMinutes: number
    workStartHour: number
    workEndHour: number
    version: number
    /** 模板 ID,null=未綁(scheduler 不啟動) */
    categoryTemplateId?: number | null
    templateName?: string | null
    /** 整份模板詳情(items + examples);main 端落到 work_template_cache */
    templateDetail?: unknown
}
