/**
 * electronAPI.ideaCapture 子介面(docs/21)。
 * 速記小窗走自己的 sandbox preload;主窗想法庫走 preload/bridges/idea-capture.bridge.ts,
 * 兩邊暴露同一份形狀。完善完成事件走 electronAPI.on(IpcChannels.IDEA_PUSH_REFINED)。
 */
import type {IpcResult as Result} from '@shared/types/ipc.types'
import type {
    IdeaCaptureConfig,
    IdeaCreateMeta,
    IdeaDetail,
    IdeaDraftAttachment,
    IdeaListItem,
    IdeaListQuery,
    IdeaPatch,
} from '@shared/types/idea-capture.types'

/** 後端 PagedResult<List<T>> 序列化後的形狀 */
export interface IdeaPaged<T> {
    pageIndex: number
    pageSize: number
    total: number
    list: T[]
}

export interface IdeaCaptureAPI {
    create: (meta: IdeaCreateMeta, files?: IdeaDraftAttachment[]) => Promise<Result<{ clientId: string; id: number }>>
    listMy: (query?: IdeaListQuery) => Promise<Result<IdeaPaged<IdeaListItem>>>
    listDept: (query?: IdeaListQuery) => Promise<Result<IdeaPaged<IdeaListItem>>>
    detail: (clientId: string) => Promise<Result<IdeaDetail>>
    patch: (clientId: string, patch: IdeaPatch) => Promise<Result<boolean>>
    remove: (clientId: string) => Promise<Result<boolean>>
    getAttachment: (url: string) => Promise<Result<string>>
    refine: (clientId: string) => Promise<Result<boolean>>
    getContext: () => Promise<Result<{ activeWindow: string }>>
    hideCapture: () => Promise<Result<boolean>>
    configRead: () => Promise<Result<IdeaCaptureConfig>>
    configWrite: (partial: Partial<IdeaCaptureConfig>) => Promise<Result<boolean>>
}
