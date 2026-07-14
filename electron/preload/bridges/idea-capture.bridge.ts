/**
 * 靈感速記 bridge(主窗用)。
 *
 * 主窗的想法庫讀寫已改渲染端直連後端(axios),不走這裡。
 * 唯一留在主進程的是 refine —— AI 完善是 30~60s 長任務,走主進程背景佇列(非阻塞 + 完成後 push),
 * 所以主窗透過本 bridge 觸發它。channel 由 preload/index.ts 注入 IpcChannels。
 */
import type {IpcRenderer} from 'electron'

export interface IdeaCaptureChannelMap {
    IDEA_REFINE: string
}

export function createIdeaCaptureBridge(ipc: IpcRenderer, ch: IdeaCaptureChannelMap) {
    return {
        /** 觸發後台 AI 完善(丟主進程佇列,立即返回;完成後 push IDEA_PUSH_REFINED) */
        refine: (clientId: string) => ipc.invoke(ch.IDEA_REFINE, {clientId}),
    }
}
