/**
 * 遠程通知 / 腳本派發 — desktop 端配置。
 * 對齊 docs/18-遠程通知與內置腳本執行設計.md §8。
 *
 * 全部欄位 dev-owned(預設值由 defaults.ts 決定;使用者不能在 UI 改 — 也不該有 UI 顯示),
 * 改值要連同 SQL DB 一起改(seed 後就落 DB)。
 */
export interface NotificationConfig {
    /** 啟用遠程通知客戶端;false = desktop 不去連 WebSocket,離線到管理端看不到這台 */
    enabled: boolean

    /**
     * WebSocket 服務端 URL(scheme + host + port,**不含 path**)。
     * desktop 客戶端會自動補上 `/ws/notifications?userName=&hostname=&...`。
     * 範例:`ws://192.168.120.79:9004`(prod)/ `ws://localhost:5247`(dev)
     */
    wsUrl: string

    /** 心跳 ping 間隔(ms);對齊後端 KeepAliveInterval 30s */
    pingIntervalMs: number

    /** 重連退避上限(ms);1s 起跳,指數退避到此上限 */
    reconnectMaxMs: number
}
