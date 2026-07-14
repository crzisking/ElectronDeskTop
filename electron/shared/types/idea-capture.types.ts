/**
 * 靈感速記(docs/21)跨進程型別契約。
 * 純 interface / union,main + preload + renderer 共用(無 runtime 物件)。
 * 欄位與後端 IdeaCapture DTO 對齊(camelCase)。
 */

export type IdeaType = 'improve' | 'issue' | 'inspiration' | 'todo'
export type IdeaVisibility = 'private' | 'dept'
export type IdeaStatus = 'inbox' | 'accepted' | 'done' | 'archived'
export type IdeaRefineStatus = 'none' | 'pending' | 'done' | 'failed'

/** 速記小窗提交的內容(不含附件二進位,附件另走 multipart) */
export interface IdeaCreateMeta {
    /** desktop 產的 uuid,冪等鍵 */
    clientId: string
    ideaType: IdeaType
    visibility: IdeaVisibility
    /** 想法本體(必填) */
    content: string
    /** 場景 / 痛點 */
    scene?: string
    /** 期望 / 下一步 */
    expectation?: string
    title?: string
    tags?: string[]
    /** 快捷鍵按下瞬間的前景視窗標題 */
    activeWindow?: string
    /** true → 交後台 AI 完善 */
    wantAI: boolean
}

/** 待上傳附件(renderer → main;貼圖給 buffer,選檔給 path) */
export interface IdeaDraftAttachment {
    fileName: string
    contentType: string
    /** 貼圖 / 剪貼簿圖:base64(不含 data: 前綴);與 path 二選一 */
    base64?: string
    /** 選檔 / 拖放:本機絕對路徑;與 base64 二選一 */
    path?: string
}

export interface IdeaListItem {
    clientId: string
    ideaType: IdeaType
    status: IdeaStatus
    refineStatus: IdeaRefineStatus
    visibility: IdeaVisibility
    title: string
    userName: string
    tags: string[]
    /** 第一張圖附件的 MinIO URL(主進程代拉) */
    thumbnailUrl?: string
    createdAt: number
}

export interface IdeaAttachmentInfo {
    id: number
    fileName: string
    fileUrl: string
    size: number
    isImage: boolean
    sortOrder: number
}

export interface IdeaDetail {
    clientId: string
    ideaType: IdeaType
    status: IdeaStatus
    visibility: IdeaVisibility
    userName: string
    title: string
    content: string
    scene?: string
    expectation?: string
    polishedText?: string
    actionItems: string[]
    aiQuestions: string[]
    refineStatus: IdeaRefineStatus
    activeWindow?: string
    tags: string[]
    attachments: IdeaAttachmentInfo[]
    createdAt: number
    updatedAt: number
}

/** 想法庫列表查詢 */
export interface IdeaListQuery {
    pageIndex?: number
    pageSize?: number
    since?: number
    status?: IdeaStatus
    ideaType?: IdeaType
    tag?: string
}

/** 使用者修改(狀態 / 三段 / 標籤增減) */
export interface IdeaPatch {
    status?: IdeaStatus
    content?: string
    scene?: string
    expectation?: string
    addTags?: string[]
    removeTags?: string[]
}

/** AI 完善結果(refiner 解析 LLM 輸出後回寫) */
export interface IdeaAiResult {
    title?: string
    polishedText?: string
    actionItems: string[]
    aiQuestions: string[]
    tags: string[]
}

/** idea-capture 桌面端配置(目前只有熱鍵) */
export interface IdeaCaptureConfig {
    /** 全域快捷鍵(Electron accelerator 字串) */
    hotkey: string
    /** 是否隨記錄帶上前景視窗標題 */
    captureActiveWindow: boolean
}
