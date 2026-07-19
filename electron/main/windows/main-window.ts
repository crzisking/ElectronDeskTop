/**
 * 主窗口 — 應用核心 UI 寄居處。
 *
 * 行為:
 *  - close 攔截為 hide(切換到浮球模式),除非 setQuitting(true) 後才放行
 *  - maximize / unmaximize 推 IPC 給 renderer 更新標題欄按鈕
 *  - 外部連結走系統瀏覽器(safeOpenExternal 過濾危險協議)
 */

import {BrowserWindow} from 'electron'
import {join} from 'path'
import {IpcChannels} from '../../shared/ipc-channels'
import {logger} from '../utils/logger'
import {safeOpenExternal} from '../utils/safe-shell'
import {appIconPath, isDev, resolveRendererEntry} from './internal'

export class MainWindow {
    private window: BrowserWindow | null = null
    private isQuitting = false

    get instance(): BrowserWindow | null {
        return this.window
    }

    /** 退出標記;true 後 close 不再 preventDefault,讓 app.quit() 不卡住 */
    setQuitting(value: boolean): void {
        this.isQuitting = value
    }

    /** 建主窗口。show:false + ready-to-show 才顯示,避免白閃 */
    create(): BrowserWindow {
        this.window = new BrowserWindow({
            width: 1200,
            height: 800,
            minWidth: 960,
            minHeight: 620,
            icon: appIconPath,
            frame: false,                     // 自定義標題欄在 Vue 中渲染
            show: false,                      // ready-to-show 後才 show
            backgroundColor: '#f3f4f6',
            webPreferences: {
                preload: join(__dirname, '../preload/index.js'),
                contextIsolation: true,
                nodeIntegration: false,
                sandbox: true,
                devTools: isDev,
            },
        })

        const entry = resolveRendererEntry('windows/main/index.html')
        if (entry.url) this.window.loadURL(entry.url)
        else this.window.loadFile(join(__dirname, '../renderer/', entry.file!))

        this.window.once('ready-to-show', () => {
            if (!this.window) return
            this.window.show()
            if (isDev) this.window.webContents.openDevTools({mode: 'detach'})
            logger.info('主窗口已顯示', 'MainWindow')
        })

        this.window.on('close', (event) => {
            if (this.isQuitting) return
            event.preventDefault()
            this.hide()
            logger.debug('主窗口 close 攔截為 hide', 'MainWindow')
        })

        // 通知 renderer 更新標題欄按鈕狀態
        this.window.on('maximize', () => {
            this.window?.webContents.send(IpcChannels.PUSH_WINDOW_MAXIMIZED, true)
        })
        this.window.on('unmaximize', () => {
            this.window?.webContents.send(IpcChannels.PUSH_WINDOW_MAXIMIZED, false)
        })

        // 外部連結轉系統瀏覽器
        this.window.webContents.setWindowOpenHandler(({url}) => {
            safeOpenExternal(url)
            return {action: 'deny'}
        })

        logger.info('主窗口已創建', 'MainWindow')
        return this.window
    }

    show(): void {
        this.window?.show()
        this.window?.focus()
    }

    hide(): void {
        this.window?.hide()
    }

    send(channel: string, ...args: unknown[]): void {
        this.window?.webContents.send(channel, ...args)
    }

    destroy(): void {
        this.window?.destroy()
        this.window = null
    }
}
