/**
 * electronAPI.ideaCapture 子介面(docs/21)。
 *
 * 兩個窗口各暴露自己需要的子集(全域型別取聯集,各窗口只呼叫自己有的):
 *  - 主窗(preload/bridges/idea-capture.bridge):只有 refine(長任務走主進程佇列)。
 *    想法庫的 list / detail / patch / delete 已改渲染端 axios 直連,不在這裡。
 *  - 速記小窗(idea-capture.preload):create / getContext / hideCapture / config。
 * 完善完成事件走 electronAPI.on(IpcChannels.IDEA_PUSH_REFINED)。
 */
import type {IpcResult as Result} from '@shared/types/ipc.types'
import type {IdeaCaptureConfig, IdeaCreateMeta, IdeaDraftAttachment} from '@shared/types/idea-capture.types'

/** 後端 PagedResult<List<T>> 序列化後的形狀(渲染端 axios 用) */
export interface IdeaPaged<T> {
    pageIndex: number
    pageSize: number
    total: number
    list: T[]
}

export interface IdeaCaptureAPI {
    // ── 速記小窗 ──
    create: (meta: IdeaCreateMeta, files?: IdeaDraftAttachment[]) => Promise<Result<{ clientId: string; id: number }>>
    getContext: () => Promise<Result<{ activeWindow: string }>>
    hideCapture: () => Promise<Result<boolean>>
    configRead: () => Promise<Result<IdeaCaptureConfig>>
    configWrite: (partial: Partial<IdeaCaptureConfig>) => Promise<Result<boolean>>
    // ── 主窗(長任務)──
    refine: (clientId: string) => Promise<Result<boolean>>
}
