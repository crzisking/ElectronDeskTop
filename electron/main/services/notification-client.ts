/**
 * NotificationClient — 連 tmbom 後端的 SignalR 客戶端。
 *
 * 設計對齊 docs/18-遠程通知與內置腳本執行設計.md(SignalR 版):
 *   - desktop 主動連 ws://{server}/hubs/notifications?userName=&hostname=&ip=&appVersion=
 *   - server 推 "Task" 事件 → ScriptRunner 執行 → connection.invoke("ReportResult", taskId, ok, summary)
 *   - server 推 "Kick" 事件 → 主動 stop(同 machineKey 重連時被舊連線取代)
 *   - 心跳 / 重連走 SignalR 內建 withAutomaticReconnect([1000, 2000, 5000, 10000, 30000])
 *   - 不帶 JWT(對齊用戶決策:內網信任)
 *
 * 為什麼放 main process:
 *   1. 唯一一份(主窗 + LogViewer + 浮球各自 renderer 不能各自連 — server 端會被踢/重複註冊)
 *   2. 直接觸達 ScriptRunner(腳本需 access app / windowManager / DB)
 *
 * 失敗策略:連線 / 重連 / send 失敗都靜默 log;絕對不擴散異常。
 */

import {hostname} from 'os'
import {app} from 'electron'
import {HubConnection, HubConnectionBuilder, HubConnectionState, LogLevel as SignalRLogLevel,} from '@microsoft/signalr'
import {logger} from '../utils/logger'
import type {ScriptRunner} from './script-runner'

const TAG = 'NotificationClient'

/** SignalR Hub 路徑;對齊後端 Program.cs MapHub<NotificationsHub>("/hubs/notifications") */
const HUB_PATH = '/hubs/notifications'

/**
 * 重連退避陣列(對齊 docs/18:1s → 2s → ... 上限 30s)。
 * SignalR 走完整個陣列後仍失敗會進 Disconnected,我們在 onclose handler 重新 start()
 * 達成「無限重連」效果。
 */
const RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 30_000]

/** Disconnected 後重啟連線的延遲 */
const RESTART_AFTER_DISCONNECT_MS = 5_000

/** server 推來的事件名(對齊後端 NotificationSender.EVENT_*) */
const EVENT_TASK = 'Task'
const EVENT_KICK = 'Kick'

/** 連線時 attach 的詮釋資料,組 query string */
export interface NotificationClientIdentity {
    userName: string
    hostname?: string
    ip?: string
    appVersion?: string
}

/** server 推 Task 事件的 payload 結構(對齊 NotificationsService.DispatchAsync 的 payload anon obj) */
interface TaskPayload {
    taskId: string
    action: string
    params?: unknown
}

export class NotificationClient {
    private connection: HubConnection | null = null
    private stopped = true
    private restartTimer: NodeJS.Timeout | null = null
    private currentUrl = ''

    /**
     * 已執行過的 taskId 集合,擋重複(對齊 docs/18 §6:server 偶爾因網路問題重推)。
     * 用 LRU 256 個,內存 ~10KB,足夠覆蓋 1 小時內所有任務。
     */
    private executedTaskIds = new Set<string>()
    private executedTaskOrder: string[] = []

    constructor(private readonly scriptRunner: ScriptRunner) {
    }

    /**
     * 啟動連線。userName 必須帶(身分);其餘 identity 欄位 server 端會自己兜 IP。
     * 同一個 instance 多次 start 視為「重連到新 server」:先 stop 舊連線。
     */
    async start(serverUrl: string, identity: NotificationClientIdentity): Promise<void> {
        if (!serverUrl || !identity.userName) {
            logger.warn('start 缺少 serverUrl / userName,跳過', TAG)
            return
        }
        if (this.connection) {
            await this.stopInternal()
        }
        this.stopped = false
        this.currentUrl = this.buildUrl(serverUrl, identity)

        this.connection = new HubConnectionBuilder()
            .withUrl(this.currentUrl, {
                // 不走預設的 negotiate(內網單純 WS 連線就夠),省一次 HTTP round-trip
                skipNegotiation: true,
                // 1 = WebSockets;skipNegotiation 必須搭固定 transport
                transport: 1,
            })
            .withAutomaticReconnect(RECONNECT_DELAYS_MS)
            // SignalR 自帶 console logger;這裡降到 Warning 避免吵
            .configureLogging(SignalRLogLevel.Warning)
            .build()

        // server → client event handlers
        this.connection.on(EVENT_TASK, (payload: TaskPayload) => this.handleTask(payload))
        this.connection.on(EVENT_KICK, (reason: string) => this.handleKick(reason))

        // 重連 / 關閉的觀察點
        this.connection.onreconnecting((err) => {
            logger.info(`SignalR 重連中: ${err?.message ?? '未知原因'}`, TAG)
        })
        this.connection.onreconnected((connectionId) => {
            logger.info(`SignalR 已重連 connId=${connectionId ?? '?'}`, TAG)
        })
        this.connection.onclose((err) => {
            // 跑完 withAutomaticReconnect 仍失敗 / server 主動 close 都會走這條
            logger.warn(`SignalR 連線關閉: ${err?.message ?? '正常關閉'}`, TAG)
            if (!this.stopped) {
                this.scheduleRestart()
            }
        })

        try {
            await this.connection.start()
            logger.info(`已連上 ${this.maskUserName(this.currentUrl)}`, TAG)
        } catch (err) {
            logger.warn(`首次連線失敗: ${(err as Error).message}`, TAG)
            // 第一次連不上不會自動進 reconnect,自己排隊
            this.scheduleRestart()
        }
    }

    /** 應用退出 / 登出時呼叫;主動 stop 連線(後端 OnDisconnectedAsync 會清 Registry) */
    async stop(): Promise<void> {
        this.stopped = true
        await this.stopInternal()
    }

    // ─── 內部 ─────────────────────────────────────────────────────────

    private buildUrl(serverUrl: string, identity: NotificationClientIdentity): string {
        const u = new URL(serverUrl)
        u.pathname = HUB_PATH
        u.searchParams.set('userName', identity.userName)
        u.searchParams.set('hostname', identity.hostname ?? hostname())
        if (identity.ip) u.searchParams.set('ip', identity.ip)
        u.searchParams.set('appVersion', identity.appVersion ?? app.getVersion())
        return u.toString()
    }

    private maskUserName(url: string): string {
        return url.replace(/userName=[^&]+/, 'userName=***')
    }

    private async handleTask(payload: TaskPayload): Promise<void> {
        if (!payload?.taskId || !payload.action) {
            logger.warn('收到不完整 task payload,丟棄', TAG)
            return
        }

        // 重複任務保護(對齊 docs/18 §6)
        if (this.executedTaskIds.has(payload.taskId)) {
            logger.debug(`重複 task taskId=${payload.taskId},拒絕`, TAG)
            return
        }
        this.markExecuted(payload.taskId)

        let result: { ok: boolean; summary: string }
        try {
            result = await this.scriptRunner.execute(payload.action, payload.params ?? {})
        } catch (err) {
            const summary = err instanceof Error ? err.message : String(err)
            logger.warn(`script ${payload.action} 執行拋例外: ${summary}`, TAG)
            result = {ok: false, summary}
        }

        // invoke ReportResult Hub 方法回報結果
        try {
            if (this.connection?.state === HubConnectionState.Connected) {
                await this.connection.invoke('ReportResult', payload.taskId, result.ok, result.summary)
            } else {
                logger.warn(`連線狀態非 Connected (${this.connection?.state}),無法回報 taskId=${payload.taskId}`, TAG)
            }
        } catch (err) {
            logger.warn(`回報結果失敗 taskId=${payload.taskId}: ${(err as Error).message}`, TAG)
        }
    }

    private async handleKick(reason: string): Promise<void> {
        // 同 machineKey 被新連線取代;主動 stop 不要重連,等下次 user 行為觸發 start
        logger.warn(`收到 Kick: ${reason},主動斷線不重連`, TAG)
        this.stopped = true
        await this.stopInternal()
    }

    private markExecuted(taskId: string): void {
        this.executedTaskIds.add(taskId)
        this.executedTaskOrder.push(taskId)
        if (this.executedTaskOrder.length > 256) {
            const oldest = this.executedTaskOrder.shift()
            if (oldest) this.executedTaskIds.delete(oldest)
        }
    }

    private scheduleRestart(): void {
        if (this.stopped) return
        if (this.restartTimer) clearTimeout(this.restartTimer)
        this.restartTimer = setTimeout(async () => {
            this.restartTimer = null
            if (this.stopped) return
            logger.info(`${RESTART_AFTER_DISCONNECT_MS}ms 後嘗試重新連線`, TAG)
            // start 內會 build 新的 HubConnection;直接走 connection.start() 對已 closed 的 instance 沒用
            try {
                await this.connection?.start()
                logger.info(`重新連線成功`, TAG)
            } catch (err) {
                logger.warn(`重新連線失敗: ${(err as Error).message}`, TAG)
                this.scheduleRestart()
            }
        }, RESTART_AFTER_DISCONNECT_MS)
    }

    private async stopInternal(): Promise<void> {
        if (this.restartTimer) {
            clearTimeout(this.restartTimer)
            this.restartTimer = null
        }
        if (this.connection) {
            try {
                // stop() 內部會發 close frame + 觸發 server.OnDisconnectedAsync
                await this.connection.stop()
            } catch {
                // 已關 / 半關狀態 stop 可能拋,不擴散
            }
            this.connection = null
        }
    }
}
