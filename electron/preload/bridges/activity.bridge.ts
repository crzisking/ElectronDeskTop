/**
 * 今日活動 bridge。前身 project-flow.bridge(功能退場後只剩今日活動聚合,純本地不打後端)。
 * 統一回 {ok, data} | {ok, error}。
 */
import type {IpcRenderer} from 'electron'
import type {IpcResult as Result} from '@shared/types/ipc.types'

export interface ActivityChannelMap {
    [key: string]: string
}

export function createActivityBridge(ipc: IpcRenderer, ch: ActivityChannelMap) {
    return {
        todayActivity: () =>
            ipc.invoke(ch.ACTIVITY_TODAY, {}) as Promise<Result<unknown>>,
    }
}
