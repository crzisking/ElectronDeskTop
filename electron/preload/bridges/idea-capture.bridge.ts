/**
 * 靈感速記 bridge(主窗用;想法庫頁在主窗)。
 * 速記小窗另走自己的 sandbox preload(idea-capture.preload.ts),兩邊形狀一致。
 * channel 由 preload/index.ts 注入 IpcChannels。
 */
import type {IpcRenderer} from 'electron'
import type {
    IdeaCreateMeta,
    IdeaDraftAttachment,
    IdeaListQuery,
    IdeaPatch,
} from '../../shared/types/idea-capture.types'

export interface IdeaCaptureChannelMap {
    IDEA_CREATE: string
    IDEA_LIST_MY: string
    IDEA_LIST_DEPT: string
    IDEA_DETAIL: string
    IDEA_PATCH: string
    IDEA_DELETE: string
    IDEA_GET_ATTACHMENT: string
    IDEA_REFINE: string
    IDEA_GET_CONTEXT: string
    IDEA_HIDE_CAPTURE: string
    IDEA_CONFIG_READ: string
    IDEA_CONFIG_WRITE: string
}

export function createIdeaCaptureBridge(ipc: IpcRenderer, ch: IdeaCaptureChannelMap) {
    return {
        create: (meta: IdeaCreateMeta, files: IdeaDraftAttachment[] = []) => ipc.invoke(ch.IDEA_CREATE, {meta, files}),
        listMy: (query: IdeaListQuery = {}) => ipc.invoke(ch.IDEA_LIST_MY, {query}),
        listDept: (query: IdeaListQuery = {}) => ipc.invoke(ch.IDEA_LIST_DEPT, {query}),
        detail: (clientId: string) => ipc.invoke(ch.IDEA_DETAIL, {clientId}),
        patch: (clientId: string, patch: IdeaPatch) => ipc.invoke(ch.IDEA_PATCH, {clientId, patch}),
        remove: (clientId: string) => ipc.invoke(ch.IDEA_DELETE, {clientId}),
        getAttachment: (url: string) => ipc.invoke(ch.IDEA_GET_ATTACHMENT, {url}),
        refine: (clientId: string) => ipc.invoke(ch.IDEA_REFINE, {clientId}),
        getContext: () => ipc.invoke(ch.IDEA_GET_CONTEXT),
        hideCapture: () => ipc.invoke(ch.IDEA_HIDE_CAPTURE),
        configRead: () => ipc.invoke(ch.IDEA_CONFIG_READ),
        configWrite: (partial: object) => ipc.invoke(ch.IDEA_CONFIG_WRITE, {partial}),
    }
}
