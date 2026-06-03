/**
 * 日誌查看器子視窗 preload。
 *
 * 暴露兩個 API:
 *   - logViewerAPI:日誌查詢專屬(query / listModules / workHealth)
 *   - electronAPI :跟主窗口同名,但**只暴露 viewer 視角需要的子集**:
 *       config.read           讀整份應用配置(workCollect 設定要從這拿)
 *       workCollect.toggle    切換採集開關
 *       workCollect.list      撈紀錄
 *       on / off              訂閱推送(白名單只放 PUSH_WORK_RECORD_NEW)
 *
 * 不暴露 tick / configRequest / syncRequest:那些事件主窗口已訂閱並走完 HTTP,
 * LogViewer 重複訂閱會兩個 renderer 同時打 AI analyze。LogViewer 只「看」。
 *
 * ⚠️ channel 字串內聯不走 @shared/ipc-channels 的原因:
 *   sandbox: true 下 Electron 不解析 chunks/,3 個 preload 共用模組會被 Rollup 抽 chunk。
 *   見 floating-ball.preload.ts 內的說明。
 */

import {contextBridge, ipcRenderer} from 'electron'

const IPC = {
    // log-viewer 專屬
    LOG_QUERY: 'log-viewer:query',
    LOG_LIST_MODULES: 'log-viewer:list-modules',
    WORK_HEALTH: 'work:health',

    // electronAPI 子集需要的 channel
    CONFIG_READ: 'config:read',
    WORK_COLLECT_TOGGLE: 'work:toggle',
    WORK_COLLECT_LIST: 'work:list',

    // 白名單推送(viewer 模式只關心「有新紀錄寫入,要 refresh」)
    PUSH_WORK_RECORD_NEW: 'push:work-record-new',
} as const

const ALLOWED_PUSH_CHANNELS: readonly string[] = [IPC.PUSH_WORK_RECORD_NEW]

/** 採集健康狀態(對齊主進程 WORK_COLLECT_HEALTH 返回) */
interface WorkHealth {
    pendingSync: number
    writeFailures: number
    markFailures: number
    lastError: string | null
    lastErrorAt: number | null
}

/** 跟主進程 LogService.query 對齊 */
interface LogQueryParams {
    level?: 'debug' | 'info' | 'warn' | 'error' | ('debug' | 'info' | 'warn' | 'error')[]
    source?: 'main' | 'renderer'
    module?: string
    since?: number
    until?: number
    search?: string
    limit?: number
    offset?: number
}

contextBridge.exposeInMainWorld('logViewerAPI', {
    query: (params: LogQueryParams) => ipcRenderer.invoke(IPC.LOG_QUERY, params),
    listModules: () => ipcRenderer.invoke(IPC.LOG_LIST_MODULES) as Promise<string[]>,
    workHealth: () => ipcRenderer.invoke(IPC.WORK_HEALTH) as Promise<WorkHealth>,
})

/**
 * on/off 走白名單,用 WeakMap 對齊主窗口 preload 的 wrapper 管理方式。
 * viewer 用不到 off,但保留對稱介面,讓 store 的 .on / .off 簽名共用。
 */
type PushCallback = (...args: unknown[]) => void
type PushWrapper = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => void

const listenerMap = new WeakMap<PushCallback, PushWrapper>()

contextBridge.exposeInMainWorld('electronAPI', {
    config: {
        read: () => ipcRenderer.invoke(IPC.CONFIG_READ),
    },
    workCollect: {
        toggle: (enabled: boolean) =>
            ipcRenderer.invoke(IPC.WORK_COLLECT_TOGGLE, enabled) as Promise<boolean>,
        list: (params: { since: number; until: number }) =>
            ipcRenderer.invoke(IPC.WORK_COLLECT_LIST, params),
    },
    on(channel: string, callback: (...args: unknown[]) => void) {
        if (!ALLOWED_PUSH_CHANNELS.includes(channel)) return
        // 重複 on 同個 callback:先拆舊 wrapper,避免 ipcRenderer 累積殘留監聽
        const existing = listenerMap.get(callback)
        if (existing) ipcRenderer.off(channel, existing)
        const wrapper = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => callback(...args)
        listenerMap.set(callback, wrapper)
        ipcRenderer.on(channel, wrapper)
    },
    off(channel: string, callback: (...args: unknown[]) => void) {
        const wrapper = listenerMap.get(callback)
        if (wrapper) {
            ipcRenderer.off(channel, wrapper)
            listenerMap.delete(callback)
        }
    },
})
