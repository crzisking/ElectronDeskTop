/**
 * 遠程通知 IPC handler:接 renderer 的 start/stop,委派給 NotificationClient。
 *
 * 為什麼是 IPC 觸發而非 main 自己 start:
 *   NotificationClient 需要 userName 才能連線(machineKey = "{userName}|{hostname}");
 *   userName 從 JWT 解出後活在 renderer authStore,main 沒有直接訪問。
 *   讓 renderer 在登入成功後 invoke NOTIFICATION_START({userName}) 是最自然的注入點。
 */

import {ipcMain} from 'electron'
import {hostname} from 'os'
import {IpcChannels} from '../../shared/ipc-channels'
import {logger} from '../utils/logger'
import type {ConfigManager} from '../config-manager'
import type {NotificationClient} from '../services/notification-client'

export function registerNotificationHandlers(
    notificationClient: NotificationClient,
    configManager: ConfigManager,
): void {
    ipcMain.handle(IpcChannels.NOTIFICATION_START, async (_e, payload: unknown): Promise<{
        ok: boolean;
        reason?: string
    }> => {
        const p = payload as { userName?: unknown } | null | undefined
        const userName = typeof p?.userName === 'string' ? p.userName.trim() : ''
        if (!userName) {
            return {ok: false, reason: 'userName 為必填'}
        }

        const cfg = configManager.getConfig().notification
        if (!cfg.enabled) {
            logger.info('notification.enabled=false,跳過 SignalR 連線', 'IPC:notification')
            return {ok: false, reason: 'disabled in config'}
        }

        // start 內部會 build HubConnection + 連線;失敗會排隊重試,不擴散異常
        await notificationClient.start(cfg.wsUrl, {
            userName,
            hostname: hostname(),
        })
        logger.info(`NotificationClient 已啟動 user=${userName} hub=${cfg.wsUrl}`, 'IPC:notification')
        return {ok: true}
    })

    ipcMain.handle(IpcChannels.NOTIFICATION_STOP, async () => {
        await notificationClient.stop()
        logger.info('NotificationClient 已關閉', 'IPC:notification')
    })
}
