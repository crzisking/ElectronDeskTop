/**
 * 「記住密碼」bridge。
 *
 * 渲染端透過此 bridge:
 *  - get()  :App.vue 啟動鉤子讀,有就走 authStore.loginBySaved
 *  - save() :LoginView 勾「記住密碼」並登入成功時呼叫
 *  - clear():logout / 首頁清除按鈕呼叫
 */
import type {IpcRenderer} from 'electron'

export interface SavedCredentialsChannelMap {
    SAVED_CREDENTIALS_GET: string
    SAVED_CREDENTIALS_SAVE: string
    SAVED_CREDENTIALS_CLEAR: string
}

export function createSavedCredentialsBridge(
    ipc: IpcRenderer,
    ch: SavedCredentialsChannelMap
) {
    return {
        get: () => ipc.invoke(ch.SAVED_CREDENTIALS_GET),
        save: (payload: { userId: string; password: string }) =>
            ipc.invoke(ch.SAVED_CREDENTIALS_SAVE, payload) as Promise<boolean>,
        clear: () => ipc.invoke(ch.SAVED_CREDENTIALS_CLEAR) as Promise<boolean>,
    }
}
