/**
 * 工作分析 IPC channels。
 *
 * 命名:WORK_ANALYSIS_* invoke;PUSH_WORK_ANALYSIS_* 為 main → renderer 推送(streaming 用)。
 *
 * 設計:
 *   分析 LLM 呼叫可能跑 30-90 秒,同步 await 體感差。改成「啟動 invoke + 流式 push」:
 *     1. renderer invoke startStream({ payload + prompt }) → 回 { runId } 或 error
 *     2. main per runId 跑 stream,delta 透過 push 廣播
 *     3. 結束時 push end,renderer 拿 finalReport 渲染
 *     4. 中途中止走 interrupt(runId)
 */
export const WorkAnalysisChannels = {
    /**
     * 取「配置階段」所需的預設值 — system prompt + 聚合後的 user content。
     * invoke。payload:{ rangeStart, rangeEnd, locale }。
     * 返回:{ ok: true; systemPrompt; userContent; recordCount } | { ok: false; reason }
     *
     * 用途:Dialog 載入時拿到預設 prompt 顯示在 textarea,使用者可改後再送 start。
     * 不直接複用 startStream 的 payload — 那個 payload 已經是「組好的 messages」,
     * Dialog 階段還沒到那一步,需要先拿預設給使用者看。
     */
    WORK_ANALYSIS_PREPARE: 'work-analysis:prepare',

    /**
     * 啟動串流分析。
     * invoke。payload:{ systemPrompt, userContent, rangeStart, rangeEnd, providerId?, model?, locale? }
     * 返回:{ ok: true; runId } | { ok: false; kind; ... }
     *
     * 啟動後 main 異步跑 stream,結果走以下 push channel 廣播。
     * 同時間只允許一個 active run(衝突時新 run 直接 reject)。
     */
    WORK_ANALYSIS_START_STREAM: 'work-analysis:start-stream',

    /** 中止串流。invoke。payload:{ runId }。返回:boolean(找到並中止) */
    WORK_ANALYSIS_INTERRUPT: 'work-analysis:interrupt',

    /** 歷史報告摘要列表(按時間倒序)。invoke。payload:{ limit? }。返回:ReportSummary[] */
    WORK_ANALYSIS_LIST: 'work-analysis:list',

    /** 取單份完整報告。invoke。payload:{ id }。返回:Report | null */
    WORK_ANALYSIS_GET: 'work-analysis:get',

    /** 取最新一份完整報告(AnalysisCard 初始載入)。invoke。返回:Report | null */
    WORK_ANALYSIS_GET_LATEST: 'work-analysis:get-latest',

    /** 今日配額狀態。invoke。返回:{ used, limit } */
    WORK_ANALYSIS_QUOTA: 'work-analysis:quota',

    /** 清空所有報告。invoke。返回:{ ok, deleted } */
    WORK_ANALYSIS_DELETE_ALL: 'work-analysis:delete-all',

    /** 測試 provider 連線(設置頁用)。invoke。payload:{ providerId? }。返回:TestResult */
    WORK_ANALYSIS_TEST_CONNECTION: 'work-analysis:test-connection',

    // ── Provider 配置 CRUD ──────────────────────────────────────
    // 沿用 agent_configs 表(由 AgentService 管),但 channel 命名歸到 work-analysis
    // 域下,因為這是「目前唯一用 provider 的 feature」的設定入口。未來 Claude SDK
    // Agent v2 上線時可考慮再抽 llm-config 獨立 channel 群組。

    /** 讀目前完整 LlmConfig(providers + activeProviderId)。invoke。返回:LlmConfig */
    WORK_ANALYSIS_READ_LLM_CONFIG: 'work-analysis:read-llm-config',

    /** 寫部分 LlmConfig。invoke。payload:Partial<LlmConfig>。返回:boolean */
    WORK_ANALYSIS_WRITE_LLM_CONFIG: 'work-analysis:write-llm-config',

    // ── Push channels(main → renderer,streaming 用)──────────

    /** Stream 文字增量。push。payload:{ runId, delta } */
    PUSH_WORK_ANALYSIS_STREAM: 'push:work-analysis-stream',

    /**
     * Stream 結束。push。
     * payload:{ runId, ok: true; structured: boolean; reportId; finalText }
     *       | { runId, ok: false; kind; error? }
     *
     * structured=true:JSON 解析 + 結構驗證都過,reportId 可用 get 取結構化 report
     * structured=false:LLM 回了但結構不符,reportId 可用 get 取 raw 內容
     * ok=false:LLM 呼叫 / DB 寫入 / 中止失敗
     */
    PUSH_WORK_ANALYSIS_END: 'push:work-analysis-end',
} as const
