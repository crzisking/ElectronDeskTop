/**
 * ProjectFlow bridge。
 *
 * ⚠️ 專案/畫布/匯報/反饋/團隊/備忘錄功能已全數清退,只剩首頁儀表板用的「今日活動」聚合
 * (純本地讀 work-collect,不打後端)。
 * 統一回 {ok: true, data} | {ok: false, error}(對齊 IPC handler safeRun 包裝)。
 */
import type {IpcRenderer} from 'electron'
// 型別 import 編譯期擦除,sandbox preload 不會因此產生 chunk
import type {IpcResult as Result} from '@shared/types/ipc.types'

export interface ProjectFlowChannelMap {
    [key: string]: string
}

export function createProjectFlowBridge(ipc: IpcRenderer, ch: ProjectFlowChannelMap) {
    const c = (action: string, args: object = {}) => ipc.invoke(action, args)

    return {
        todayActivity: () =>
            c(ch.PROJECT_FLOW_TODAY_ACTIVITY, {}) as Promise<Result<unknown>>,
    }
}
