/**
 * 每日學習建議 IPC channels。
 *
 * 全本地功能:工種(workCollect 模板)+ 近 7 天工作紀錄 → 本地 LlmClient 生成
 * 學習建議,不經過後端。每天 08:00 排程生成,錯過(App 沒開)則啟動時補。
 */
export const DailyAdviceChannels = {
    /**
     * 首頁初始載入:前置條件狀態 + 今日建議 + 最近歷史。
     * invoke。返回:{templateBound, templateName, llmConfigured, today: Row|null, recent: Row[]}
     */
    DAILY_ADVICE_STATUS: 'daily-advice:status',

    /** 手動立即生成(覆蓋今日)。invoke。返回:{ok: true; row} | {ok: false; error} */
    DAILY_ADVICE_GENERATE: 'daily-advice:generate',

    /** 生成完成推送(排程 / 手動都會發)。push。payload:DailyAdviceRow */
    PUSH_DAILY_ADVICE: 'push:daily-advice',
} as const
