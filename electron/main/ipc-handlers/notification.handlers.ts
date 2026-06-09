/**
 * 遠程通知 IPC handler:接 renderer 的 start/stop,委派給 NotificationClient。
 *
 * 為什麼是 IPC 觸發而非 main 自己 start:
 *   NotificationClient 需要 userName 才能連線(machineKey = "{userName}|{hostname}");
 *   userName 從 JWT 解出後活在 renderer authStore,main 沒有直接訪問。
 *   讓 renderer 在登入成功後 invoke NOTIFICATION_START({userName}) 是最自然的注入點。
 */

import {ipcMain} from 'electron'
import {hostname, networkInterfaces} from 'os'
import {createSocket} from 'dgram'
import {IpcChannels} from '../../shared/ipc-channels'
import {logger} from '../utils/logger'
import type {ConfigManager} from '../config-manager'
import type {NotificationClient} from '../services/notification-client'

/**
 * UDP 路由表探測目標。
 * 走 connect 不送封包,只讓 OS 算出送到此 IP 的 source interface,
 * 對端是否可達不重要。挑公司 LAN 內肯定能路由到的位址(prod tmbom 後端 host),
 * 確保 dev / prod 在公司網路內都會抓到正確的網段。
 */
const ROUTE_PROBE_HOST = '192.168.120.79'

/**
 * 取本機「連外」用的 IPv4 地址。
 *
 * 策略 1(優先):dgram.connect(udp4) 對任意 host 做 routing-table 查詢,
 *   不送封包,只取 socket 綁定後的 source IP。這就是 OS 路由表選的「主」介面 IP。
 *   能精準避開 VMware / VirtualBox / vEthernet / TAP-VPN 等虛擬網卡。
 *
 * 策略 2(fallback):用 networkInterfaces() 掃,過濾掉 loopback + 已知虛擬卡名稱,
 *   取第一個 IPv4。不夠精準(多張實體網卡時可能挑錯),但保證有值。
 *
 * 為什麼自己算不靠 server 端 RemoteIpAddress:
 *   dev 模式 desktop ↔ backend 同機器 connection 走 loopback → server 端看到 ::1。
 *   顯式上報能讓 dev / prod 看到一致且有業務意義的網段。
 */
async function pickLocalIPv4(): Promise<string | undefined> {
    const viaRouting = await pickViaRoutingTable()
    if (viaRouting) return viaRouting
    return pickViaInterfaceScan()
}

function pickViaRoutingTable(): Promise<string | undefined> {
    return new Promise((resolve) => {
        let settled = false
        const sock = createSocket('udp4')
        const done = (ip: string | undefined) => {
            if (settled) return
            settled = true
            try {
                sock.close()
            } catch { /* socket 可能已關 */
            }
            resolve(ip)
        }
        // 2 秒兜底,避免極端網路狀況下卡住
        const timer = setTimeout(() => done(undefined), 2_000)
        sock.once('error', () => {
            clearTimeout(timer);
            done(undefined)
        })
        try {
            // dgram.connect 對 UDP 不真的握手,只記目標 + 詢問 OS 路由表選 source IP
            sock.connect(53, ROUTE_PROBE_HOST, () => {
                clearTimeout(timer)
                try {
                    const addr = sock.address()
                    done(addr?.address && addr.address !== '0.0.0.0' ? addr.address : undefined)
                } catch {
                    done(undefined)
                }
            })
        } catch {
            clearTimeout(timer)
            done(undefined)
        }
    })
}

/** 已知虛擬網卡名稱關鍵字;命中就跳過。涵蓋 Windows / macOS / Linux 主流虛擬化 / VPN 工具 */
const VIRTUAL_ADAPTER_PATTERN = /vmware|virtualbox|hyper-?v|vethernet|wsl|tap|tun|tunnel|teredo|bluetooth|loopback|docker/i

function pickViaInterfaceScan(): string | undefined {
    const ifaces = networkInterfaces()
    // 先試非虛擬卡
    for (const name in ifaces) {
        if (VIRTUAL_ADAPTER_PATTERN.test(name)) continue
        const list = ifaces[name]
        if (!list) continue
        for (const it of list) {
            if (it.family === 'IPv4' && !it.internal) return it.address
        }
    }
    // 全被過濾 → 寧可拿虛擬卡也別空,server 端至少有資訊
    for (const name in ifaces) {
        const list = ifaces[name]
        if (!list) continue
        for (const it of list) {
            if (it.family === 'IPv4' && !it.internal) return it.address
        }
    }
    return undefined
}

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
        const ip = await pickLocalIPv4()
        await notificationClient.start(cfg.wsUrl, {
            userName,
            hostname: hostname(),
            ip,
        })
        logger.info(`NotificationClient 已啟動 user=${userName} ip=${ip ?? 'unknown'} hub=${cfg.wsUrl}`, 'IPC:notification')
        return {ok: true}
    })

    ipcMain.handle(IpcChannels.NOTIFICATION_STOP, async () => {
        await notificationClient.stop()
        logger.info('NotificationClient 已關閉', 'IPC:notification')
    })
}
