/**
 * 遠程通知 bridge(docs/18)。
 *
 * renderer 端的 authStore 在登入成功後呼叫 start(userName),登出時呼叫 stop()。
 * 實際 WebSocket 連線在 main process,renderer 不直接接觸 socket。
 */
import type {IpcRenderer} from 'electron'

export interface NotificationChannelMap {
    NOTIFICATION_START: string
    NOTIFICATION_STOP: string
}

interface StartResult {
    ok: boolean
    reason?: string
}

export function createNotificationBridge(ipc: IpcRenderer, ch: NotificationChannelMap) {
    return {
        /** 登入成功後呼叫;main 端會用 userName 建立 WebSocket 連線到 tmbom server */
        start: (userName: string) =>
            ipc.invoke(ch.NOTIFICATION_START, {userName}) as Promise<StartResult>,
        /** 登出 / 應用退出前呼叫 */
        stop: () => ipc.invoke(ch.NOTIFICATION_STOP) as Promise<void>,
    }
}
