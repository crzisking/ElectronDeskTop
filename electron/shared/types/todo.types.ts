/**
 * 桌面代辦(docs/23)跨進程型別契約。
 * 純 interface / type,main / preload / renderer 三端共用(無 runtime)。
 * 本地 SQLite 儲存;schema.ts 的欄位型別由此收斂。
 */

export type TodoStatus = 'inbox' | 'active' | 'done' | 'dropped'
export type TodoKind = 'task' | 'bug' | 'meeting' | 'reminder'
/** '' = 未定;AI 會填 work / life */
export type TodoCategory = 'work' | 'life' | ''
export type TodoSource = 'keyboard' | 'voice'
export type TodoAiState = 'pending' | 'done' | 'failed' | 'skipped'
export type TodoDueKind = 'today' | 'thisweek' | 'none'

/** 優先級:0 低 / 1 中 / 2 高(對齊後端 Project_Memos 語義) */
export type TodoPriority = 0 | 1 | 2

/** 一條代辦(= 本地 todos 表一行) */
export interface Todo {
    id: string
    /** 那句原話,永遠保留 */
    content: string
    /** 顯示標題,缺省 = content */
    title: string
    note: string | null
    status: TodoStatus
    kind: TodoKind
    priority: TodoPriority
    category: TodoCategory
    owner: string | null
    /** 絕對截止 unix ms;無為 null */
    dueAt: number | null
    dueKind: TodoDueKind
    source: TodoSource
    aiState: TodoAiState
    /** AI 給的一句提示 */
    aiHint: string | null
    /** 漸進式完善:上次提示補充的時間 ms */
    enrichPromptedAt: number | null
    createdAt: number
    updatedAt: number
    completedAt: number | null
}

/** 建立:錄入永遠只有一句話 */
export interface TodoCreateInput {
    content: string
    source?: TodoSource
}

/** 局部更新(卡片就地改) */
export interface TodoPatch {
    title?: string
    note?: string | null
    status?: TodoStatus
    kind?: TodoKind
    priority?: TodoPriority
    category?: TodoCategory
    owner?: string | null
    dueAt?: number | null
    dueKind?: TodoDueKind
    aiState?: TodoAiState
    aiHint?: string | null
    enrichPromptedAt?: number | null
}

/** 備注窗載入時查的編輯目標 */
export interface TodoNoteTarget {
    id: string
    title: string
    note: string | null
}

/** dock 頂部資訊條 + 計數用 */
export interface TodoCounts {
    /** 今天該做(active 且今天到期或逾期) */
    today: number
    /** 收件箱(待 AI / 待整理) */
    inbox: number
    /** 全部未完成 */
    active: number
}
