/**
 * 想法庫 renderer 端型別 —— 這些型別的讀取走 axios 直連後端(不過 IPC),故只在渲染層用,
 * 從跨進程 `@shared/types/idea-capture.types` 移來這裡(shared 只留真跨進程的:enums +
 * IdeaCreateMeta / IdeaDraftAttachment / IdeaCaptureConfig)。enums 從 shared re-export,消費端一處拿全。
 */

export type {IdeaType, IdeaVisibility, IdeaStatus, IdeaRefineStatus} from '@shared/types/idea-capture.types'
import type {IdeaType, IdeaVisibility, IdeaStatus, IdeaRefineStatus} from '@shared/types/idea-capture.types'

export interface IdeaAttachmentInfo {
    id: number
    fileName: string
    fileUrl: string
    size: number
    isImage: boolean
    sortOrder: number
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
