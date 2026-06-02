/**
 * 工作採集配置 — app-config.json 的 "workCollect" 區塊。
 */
export interface WorkCollectConfig {
  /**
   * 採集總開關;false 時 scheduler 不啟動,完全不採集 / 不上傳。
   * 渲染端「啟用採集」開關透過 IPC WORK_COLLECT_TOGGLE 寫入此欄位。
   */
  enabled: boolean

  /** 採集間隔(分鐘),預設 5,允許 1-60 */
  intervalMinutes: number

  /**
   * 工時開始小時(24h),預設 8。
   * 採集只在 [workStartHour, workEndHour) 區間內進行。
   */
  workStartHour: number

  /**
   * 工時結束小時(24h),預設 17,「不含」此小時。
   * 設 17 表示 17:00:00 整就停止(覆蓋 8:00 ~ 16:59:59)。
   */
  workEndHour: number

    /**
     * 業務分類模板 ID(從 my-config 同步下來)。
     * null = 未綁,scheduler 不啟動採集(設定不完整等同未啟用)。
     */
    categoryTemplateId?: number | null

    /** 模板名稱,設定頁顯示「我的崗位」用 */
    templateName?: string | null
}
