/**
 * 工作採集 IPC channels。
 *
 * 命名:WORK_COLLECT_* 為 renderer→main invoke;PUSH_* 為 main→renderer send。
 * 集中化 sync(docs/20):HTTP 在 renderer 跑,main 只推「該 sync / pull」,結果 IPC 回 main。
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

    // ── 集中化 sync(docs/20) ──────────────────────────────────────────

    /** 推 renderer 上傳 unsynced(send {reason}) */
  PUSH_WORK_COLLECT_SYNC_REQUEST: 'push:work-collect-sync-request',
    /** 推 renderer 拉 /my-config(send) */
  PUSH_WORK_COLLECT_CONFIG_REQUEST: 'push:work-collect-config-request',
    /** 撈 synced=0(invoke limit → WorkRecord[]) */
  WORK_COLLECT_LIST_UNSYNCED: 'work:list-unsynced',
    /** 標記已同步(invoke {localIds,syncedAt} → OpResult) */
  WORK_COLLECT_MARK_SYNCED: 'work:mark-synced',
    /** 套用 server 配置(invoke config → {changed}) */
  WORK_COLLECT_APPLY_REMOTE_CONFIG: 'work:apply-remote-config',
    /** renderer bootstrap ack,main 重放 pending(invoke) */
    WORK_COLLECT_RENDERER_READY: 'work:renderer-ready',
    /** renderer sync 完成 ack,main 清 / 保留 pending(invoke {ok,synced,failed,error}) */
    WORK_COLLECT_SYNC_DONE: 'work:sync-done',
    /** 查採集健康狀態(invoke → {pendingSync, writeFailures, markFailures, lastError, lastErrorAt}) */
    WORK_COLLECT_HEALTH: 'work:health',
} as const
