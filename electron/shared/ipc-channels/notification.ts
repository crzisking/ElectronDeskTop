/**
 * 遠程通知 / 腳本派發 IPC channels(對齊 docs/18)。
 *
 * 命名:NOTIFICATION_* 為 renderer → main invoke。
 * 目前 WebSocket 推播是 main 端事務,沒有 main → renderer 推送,所以這裡只有兩個 invoke。
 */
export const NotificationChannels = {
    /**
     * renderer 通知 main:使用者已登入,把 userName 帶過來啟動 WebSocket 連線。
     * payload: { userName: string }
     * 重複呼叫:main 端會重連(useCase:token 變了 / 換帳號)
     */
    NOTIFICATION_START: 'notification:start',
    /** 登出 / 應用退出時呼叫,主動關閉 WebSocket */
    NOTIFICATION_STOP: 'notification:stop',
} as const
