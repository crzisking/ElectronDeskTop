/**
 * 工作採集 IPC channels。
 *
 * 命名:WORK_COLLECT_* 為 renderer→main invoke;PUSH_* 為 main→renderer send。
 *
 * 集中化 sync(docs/11 + v1.4.x 再次集中):
 *   - **AI analyze HTTP**:仍在 renderer 跑(scheduler 推 tick → renderer 拿截圖打 AI → 回 main 寫 DB)
 *     原因:截圖在 renderer 已有 jpeg buffer,直接打 AI 省 IPC 序列化;analyze 也要 JWT,renderer 直接帶
 *   - **sync-daily HTTP**:已搬到 main(WORK_COLLECT_RUN_SYNC,renderer 一次 invoke 觸發整段 50 輪)
 *     原因:純 DB IO + HTTP,renderer 跑要 100× IPC 往返,搬 main 後直接 DB 操作
 *   - **my-config HTTP**:仍在 renderer 跑(PUSH_WORK_COLLECT_CONFIG_REQUEST → renderer 拉 → applyRemoteConfig 回 main)
 */
export const WorkCollectChannels = {
    /** 切換採集開關(invoke boolean → boolean) */
  WORK_COLLECT_TOGGLE: 'work:toggle',
    /** 查紀錄(invoke {since,until} → WorkRecord[]) */
  WORK_COLLECT_LIST: 'work:list',
    /** scheduler 推採集 tick 給 renderer 打 AI(send) */
  PUSH_WORK_COLLECT_TICK: 'push:work-collect-tick',
    /** renderer 回送 AI 結果寫 DB(send WorkResultPayload) */
  WORK_COLLECT_RESULT: 'work:result',
    /** DB 寫入後通知 renderer 刷新流水線(push) */
  PUSH_WORK_RECORD_NEW: 'push:work-record-new',

    // ── 集中化 sync(docs/11) ──────────────────────────────────────────

    /** 推 renderer 上傳 unsynced(send {reason}) */
  PUSH_WORK_COLLECT_SYNC_REQUEST: 'push:work-collect-sync-request',
    /** 推 renderer 拉 /my-config(send) */
  PUSH_WORK_COLLECT_CONFIG_REQUEST: 'push:work-collect-config-request',
  /** 撈 synced=0(invoke limit → WorkRecord[])— v1.4.x 集中化 sync 後保留作 debug / 健康查詢用 */
  WORK_COLLECT_LIST_UNSYNCED: 'work:list-unsynced',
  /** 標記已同步(invoke {localIds,syncedAt} → OpResult)— 同上,保留作低階介面 */
  WORK_COLLECT_MARK_SYNCED: 'work:mark-synced',
  /**
   * 主進程跑 sync 主流程(invoke WorkSyncRunPayload → WorkSyncRunResult)。
   * 原本 listUnsynced + HTTP + markSynced 在 renderer 跑,每批 2 次 IPC,
   * 50 批 ~ 100 次 IPC。集中化後整段邏輯在 main(直接 DB 操作),renderer 只發一次 IPC。
   * 帶 token / baseUrl 是因為 main 缺 auth 環境,renderer 在發起時即時注入。
   */
  WORK_COLLECT_RUN_SYNC: 'work:run-sync',
    /** 套用 server 配置(invoke config → {changed}) */
  WORK_COLLECT_APPLY_REMOTE_CONFIG: 'work:apply-remote-config',
    /**
     * 讀本地模板 cache(invoke → CachedTemplateDetail | null)。
     * renderer 拿來建 category code → label 對照表,給 UI 顯示分類中文名用。
     * 沒拉到 server config(或被解綁)就 cache 為空 → 回 null,renderer 回退到 raw code。
     */
    WORK_COLLECT_GET_TEMPLATE: 'work:get-template',
    /** renderer bootstrap ack,main 重放 pending(invoke) */
    WORK_COLLECT_RENDERER_READY: 'work:renderer-ready',
    /** renderer sync 完成 ack,main 清 / 保留 pending(invoke {ok,synced,failed,error}) */
    WORK_COLLECT_SYNC_DONE: 'work:sync-done',
    /** 查採集健康狀態(invoke → {pendingSync, writeFailures, markFailures, lastError, lastErrorAt}) */
    WORK_COLLECT_HEALTH: 'work:health',
} as const
