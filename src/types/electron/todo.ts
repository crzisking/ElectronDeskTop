/**
 * electronAPI.todo 子介面(docs/23)。
 *
 * 兩個代辦窗各暴露自己需要的子集(全域型別取聯集):
 *  - 錄入窗(todo-capture.preload):create / hideCapture
 *  - dock 窗(todo-dock.preload):listOpen / counts / get / patch / complete / setStatus / snooze
 * 變更推送走 electronAPI.on(IpcChannels.PUSH_TODO_CHANGED)。
 */
import type {IpcResult as Result} from '@shared/types/ipc.types'
import type {Todo, TodoCounts, TodoCreateInput, TodoPatch, TodoStatus} from '@shared/types/todo.types'

export interface TodoAPI {
    // ── 錄入窗 ──
    create: (input: TodoCreateInput) => Promise<Result<Todo>>
    hideCapture: () => Promise<Result<boolean>>
    /** 🎤 觸發系統語音輸入(Win+H) */
    triggerVoice: () => Promise<Result<boolean>>
    // ── dock 窗 ──
    listOpen: () => Promise<Result<Todo[]>>
    counts: () => Promise<Result<TodoCounts>>
    get: (id: string) => Promise<Result<Todo | null>>
    patch: (id: string, patch: TodoPatch) => Promise<Result<Todo>>
    complete: (id: string) => Promise<Result<boolean>>
    setStatus: (id: string, status: TodoStatus) => Promise<Result<boolean>>
    snooze: (id: string, dueAt: number) => Promise<Result<boolean>>
    /** dock 懸停切換滑鼠穿透(fire-and-forget) */
    dockSetInteractive: (on: boolean) => void
    /** dock「+ 快速記錄」開錄入窗 */
    openCapture: () => Promise<Result<boolean>>
}
