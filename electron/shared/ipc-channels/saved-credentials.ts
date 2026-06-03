/**
 * 「記住密碼」相關 IPC channels。
 *
 * App.vue 啟動鉤子 / LoginView / 登出流程都會用到,渲染端透過
 * window.electronAPI.savedCredentials.{get,save,clear} 走這幾個 channel。
 */
export const SavedCredentialsChannels = {
    /**
     * 讀取已記住的憑證。
     * invoke。返回:{ userId, password, updatedAt } | null
     */
    SAVED_CREDENTIALS_GET: 'saved-credentials:get',

    /**
     * 寫入或更新已記住的憑證(以 userId 為 conflict target,內部會先清舊行)。
     * invoke。payload:{ userId, password }。返回:boolean
     */
    SAVED_CREDENTIALS_SAVE: 'saved-credentials:save',

    /**
     * 清空已記住的憑證。
     * invoke。返回:boolean
     */
    SAVED_CREDENTIALS_CLEAR: 'saved-credentials:clear',
} as const
