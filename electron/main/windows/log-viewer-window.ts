/**
 * 日誌查看器子視窗 — 管理員工具。
 *
 * 跟主窗 / 浮球不一樣:
 *  - 不持久化,關閉即銷毀,下次重新建,閒置不占資源
 *  - 用獨立 preload(log-viewer.preload.js),只暴露 logQuery
 *  - frame:true 沿用系統標題欄,管理員看著舒服
 *
 * 呼叫前主進程已驗過解鎖狀態(見 log-viewer.handlers.ts),這裡不再重複驗。
 */

import {BrowserWindow} from 'electron'
import {join} from 'path'
import {logger} from '../utils/logger'
import {appIconPath, isDev, resolveRendererEntry} from './internal'

export class LogViewerWindow {
    private window: BrowserWindow | null = null

    get instance(): BrowserWindow | null {
        return this.window
    }

    /** 開啟。已開過就拉到前台,不重建 */
    open(parent: BrowserWindow | null): BrowserWindow {
        if (this.window && !this.window.isDestroyed()) {
            this.window.show()
            this.window.focus()
            return this.window
        }

        this.window = new BrowserWindow({
            width: 1100,
            height: 720,
            minWidth: 900,
            minHeight: 500,
            icon: appIconPath,
            title: '日誌查看器',
            frame: true,
            show: false,
            backgroundColor: '#f3f4f6',
            // 主窗的子視窗,主窗最小化時跟著消失(避免遺留視窗)
            parent: parent ?? undefined,
            webPreferences: {
                preload: join(__dirname, '../preload/log-viewer.preload.js'),
                contextIsolation: true,
                nodeIntegration: false,
                sandbox: true,
                devTools: isDev,
            },
        })

        const entry = resolveRendererEntry('windows/log-viewer/index.html')
        if (entry.url) this.window.loadURL(entry.url)
        else this.window.loadFile(join(__dirname, '../renderer/', entry.file!))

        this.window.once('ready-to-show', () => {
            this.window?.show()
            if (isDev) this.window?.webContents.openDevTools({mode: 'detach'})
            logger.info('日誌查看器已開啟', 'LogViewerWindow')
        })

        this.window.on('closed', () => {
            this.window = null
            logger.info('日誌查看器已關閉', 'LogViewerWindow')
        })

        return this.window
    }

    destroy(): void {
        this.window?.destroy()
        this.window = null
    }
}
