/**
 * 代辦 bridge(主窗用子集,docs/23)。
 *
 * 主窗首頁「代辦」區塊只需:讀未完成列表、勾完成、拉起錄入窗。
 * 其餘 CRUD / dock 專屬能力在各自的窗口 preload(todo-dock / todo-capture / todo-note)。
 * 變更推送走 electronAPI.on(IpcChannels.PUSH_TODO_CHANGED) 即時刷新。
 */
import type {IpcRenderer} from 'electron'
import type {IpcResult as Result} from '@shared/types/ipc.types'
import type {Todo} from '@shared/types/todo.types'

export interface TodoChannelMap {
    [key: string]: string
}

export function createTodoBridge(ipc: IpcRenderer, ch: TodoChannelMap) {
    return {
        /** 未完成列表(active + inbox),首頁顯示用 */
        listOpen: () => ipc.invoke(ch.TODO_LIST_OPEN) as Promise<Result<Todo[]>>,
        /** 勾完成(真刪除) */
        complete: (id: string) => ipc.invoke(ch.TODO_COMPLETE, {id}) as Promise<Result<boolean>>,
        /** 拉起錄入窗(等同 Ctrl+/) */
        openCapture: () => ipc.invoke(ch.TODO_OPEN_CAPTURE) as Promise<Result<boolean>>,
    }
}
