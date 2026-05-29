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

  /* ── 集中化 sync(docs/20) ────────────────────────────────────────
   * HTTP 必須在 renderer 走(JWT 在 OAuth store + 統一 auth 攔截器),
   * 所以 main scheduler 只決策「該不該 sync / 該不該拉 config」,
   * 推給 renderer 去做 HTTP,結果再 IPC 回主進程寫 DB / 寫 config。
   */

  /**
   * PUSH_WORK_COLLECT_SYNC_REQUEST:main → renderer
   * 要求 renderer 把本地 unsynced records 批次 POST 到 /sync-daily。
   * payload:{ reason: 'startup' | 'work-end' | 'safety-net' }
   */
  PUSH_WORK_COLLECT_SYNC_REQUEST: 'push:work-collect-sync-request',

  /**
   * PUSH_WORK_COLLECT_CONFIG_REQUEST:main → renderer
   * 要求 renderer 拉 /my-config,拿到後透過 WORK_COLLECT_APPLY_REMOTE_CONFIG 寫回。
   */
  PUSH_WORK_COLLECT_CONFIG_REQUEST: 'push:work-collect-config-request',

  /**
   * WORK_COLLECT_LIST_UNSYNCED:renderer → main(invoke)
   * 撈本地 synced=0 的紀錄;limit 預設 200(與 server 單請求上限一致)。
   * 返回:WorkRecord[]
   */
  WORK_COLLECT_LIST_UNSYNCED: 'work:list-unsynced',

  /**
   * WORK_COLLECT_MARK_SYNCED:renderer → main(invoke)
   * sync-daily 成功後標記 localIds 為已同步。payload:{ localIds, syncedAt }
   */
  WORK_COLLECT_MARK_SYNCED: 'work:mark-synced',

  /**
   * WORK_COLLECT_APPLY_REMOTE_CONFIG:renderer → main(invoke)
   * server 配置回來後寫入 ConfigManager + 比對版本決定是否 restart scheduler。
   * payload:WorkConfigResponse;返回:{ changed: boolean }
   */
  WORK_COLLECT_APPLY_REMOTE_CONFIG: 'work:apply-remote-config',

    /**
     * WORK_COLLECT_RENDERER_READY:renderer → main(invoke)
     * store.bootstrap() 完成訂閱後立刻 invoke。
     * 主進程收到後補推任何 pending 的 config / sync request,
     * 處理「main 已推但 renderer 未訂閱」的開機競態。
     */
    WORK_COLLECT_RENDERER_READY: 'work:renderer-ready',
} as const
