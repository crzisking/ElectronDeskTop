/**
 * 工作自動採集 bridge。
 *
 * 主進程 scheduler 跑 timer + capture,然後 PUSH_WORK_COLLECT_TICK 推給渲染端;
 * 渲染端拿截圖呼叫後端 AI(走 createHttpClient 複用 auth),結果用 sendResult 回送;
 * 主進程 handler 寫 DB + 推 PUSH_WORK_RECORD_NEW 通知 UI 刷新。
 */
import type {IpcRenderer} from 'electron'

export interface WorkCollectChannelMap {
  WORK_COLLECT_TOGGLE: string
  WORK_COLLECT_LIST: string
  WORK_COLLECT_RESULT: string
    WORK_COLLECT_LIST_UNSYNCED: string
    WORK_COLLECT_MARK_SYNCED: string
    WORK_COLLECT_APPLY_REMOTE_CONFIG: string
}

export function createWorkCollectBridge(ipc: IpcRenderer, ch: WorkCollectChannelMap) {
  return {
    toggle: (enabled: boolean) =>
      ipc.invoke(ch.WORK_COLLECT_TOGGLE, enabled) as Promise<boolean>,
    list: (params: {since: number; until: number}) =>
      ipc.invoke(ch.WORK_COLLECT_LIST, params),
    sendResult: (payload: unknown) => ipc.send(ch.WORK_COLLECT_RESULT, payload),

      /** 集中化:撈未同步紀錄(synced=0),limit 上限對齊 server 200 條/批 */
      listUnsynced: (limit: number = 200) =>
          ipc.invoke(ch.WORK_COLLECT_LIST_UNSYNCED, limit) as Promise<unknown[]>,

      /** 集中化:server sync-daily 成功後標記已同步 */
      markSynced: (localIds: number[], syncedAt: number) =>
          ipc.invoke(ch.WORK_COLLECT_MARK_SYNCED, {localIds, syncedAt}) as Promise<void>,

      /**
       * 集中化:把 server 端配置寫入本地 ConfigManager。
       * 主進程內部會比對版本決定是否 restart scheduler。
       * 返回 { changed: boolean }:配置實際有變動才為 true。
       */
      applyRemoteConfig: (config: {
          enabled: boolean
          intervalMinutes: number
          workStartHour: number
          workEndHour: number
          version: number
      }) =>
          ipc.invoke(ch.WORK_COLLECT_APPLY_REMOTE_CONFIG, config) as Promise<{ changed: boolean }>,
  }
}
