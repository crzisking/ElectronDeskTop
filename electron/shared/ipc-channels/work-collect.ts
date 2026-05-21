/**
 * 工作自動採集相關 IPC channels。
 */
export const WorkCollectChannels = {
  /**
   * WORK_COLLECT_TOGGLE:切換採集開關。主進程寫 config + 啟停 scheduler。
   * invoke。payload:boolean。返回:boolean
   */
  WORK_COLLECT_TOGGLE: 'work:toggle',

  /**
   * WORK_COLLECT_LIST:查詢採集紀錄。
   * invoke。payload:{ since, until }。返回:WorkRecord[]
   */
  WORK_COLLECT_LIST: 'work:list',

  /**
   * PUSH_WORK_COLLECT_TICK:scheduler 每次採集到截圖後推給渲染端處理 HTTP。
   * send(main → renderer)。
   * payload:{ jpeg, activeWindow, appName, allWindows, capturedAt }
   */
  PUSH_WORK_COLLECT_TICK: 'push:work-collect-tick',

  /**
   * WORK_COLLECT_RESULT:渲染端拿到 AI 結果後送回主進程,handler 寫 DB。
   * send。payload:WorkResultPayload
   */
  WORK_COLLECT_RESULT: 'work:result',

  /** PUSH_WORK_RECORD_NEW:DB 寫入成功後通知渲染端刷新流水線 */
  PUSH_WORK_RECORD_NEW: 'push:work-record-new',
} as const
