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
}

export function createWorkCollectBridge(ipc: IpcRenderer, ch: WorkCollectChannelMap) {
  return {
    toggle: (enabled: boolean) =>
      ipc.invoke(ch.WORK_COLLECT_TOGGLE, enabled) as Promise<boolean>,
    list: (params: {since: number; until: number}) =>
      ipc.invoke(ch.WORK_COLLECT_LIST, params),
    sendResult: (payload: unknown) => ipc.send(ch.WORK_COLLECT_RESULT, payload),
  }
}
