/**
 * 桌面代辦(docs/23)IPC channels。
 * 本地 SQLite CRUD;dock 窗 / 捕獲窗 / 主窗共用。錄入一句話 → 存 → 廣播刷新。
 */
export const TodoChannels = {
    /** 建立(一句話) */
    TODO_CREATE: 'todo:create',
    /** 未完成列表(active + inbox),dock 顯示用 */
    TODO_LIST_OPEN: 'todo:list-open',
    /** 單筆 */
    TODO_GET: 'todo:get',
    /** 局部更新(卡片就地改) */
    TODO_PATCH: 'todo:patch',
    /** 完成 */
    TODO_COMPLETE: 'todo:complete',
    /** 改狀態(inbox/active/done/dropped) */
    TODO_SET_STATUS: 'todo:set-status',
    /** 延後(設新截止) */
    TODO_SNOOZE: 'todo:snooze',
    /** 資訊條計數(今天 / 收件箱 / 全部未完成) */
    TODO_COUNTS: 'todo:counts',
    /** 捕獲窗保存/取消後隱藏自己 */
    TODO_HIDE_CAPTURE: 'todo:hide-capture',
    /** dock 窗切換滑鼠穿透:true=可交互(懸停面板時)/ false=穿透(平時透明不擋)。send/on */
    TODO_DOCK_SET_INTERACTIVE: 'todo:dock-set-interactive',
    /** dock 面板「+ 快速記錄」→ 開錄入窗(等同按 Ctrl+/) */
    TODO_OPEN_CAPTURE: 'todo:open-capture',
    /** 錄入窗 🎤 → 觸發 Windows 系統語音輸入(Win+H) */
    TODO_TRIGGER_VOICE: 'todo:trigger-voice',
    /** PUSH:錄入窗已顯示 → 通知渲染層先聚焦 input 再拉語音(保證順序,修焦點競態) */
    TODO_CAPTURE_SHOWN: 'todo:capture-shown',
    /** dock 卡片「備注」→ 開可聚焦備注小窗(帶 id) */
    TODO_OPEN_NOTE: 'todo:open-note',
    /** 備注窗載入時查當前編輯目標 → 回 {id, title, note} */
    TODO_NOTE_TARGET: 'todo:note-target',
    /** 備注窗保存/取消後隱藏自己 */
    TODO_HIDE_NOTE: 'todo:hide-note',

    /** PUSH:代辦有變動 → 通知所有代辦窗 + 主窗刷新 */
    PUSH_TODO_CHANGED: 'todo:push:changed',
} as const
