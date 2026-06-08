/**
 * electronAPI.notification 子介面 — 遠程通知 / 腳本派發(docs/18)。
 * 實際 WebSocket 連線在主進程,renderer 只負責通知 main 開始/結束連線。
 */
export interface NotificationAPI {
    /**
     * 登入成功後呼叫,main 端會建立 WebSocket 到 tmbom server。
     * 回 {ok, reason?}:disabled / 缺 userName 都會 ok=false 但 not 拋例外。
     */
    start: (userName: string) => Promise<{ ok: boolean; reason?: string }>

    /** 登出 / 應用退出時呼叫;main 主動 unregister + close socket */
    stop: () => Promise<void>
}
