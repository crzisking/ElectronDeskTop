/**
 * AI Agent 獨立窗口。
 *
 * 跟 log-viewer 同模式:
 *  - 不持久化,關閉即銷毀
 *  - 獨立 preload(agent.preload.js)
 *  - 完全獨立於主窗,互不干擾
 *
 * 由浮球快捷菜單(quickMenu action: 'open-agent')或主窗按鈕觸發。
 */

import {BrowserWindow} from 'electron'
import {join} from 'path'
import {logger} from '../utils/logger'
import {safeOpenExternal} from '../utils/safe-shell'
import {appIconPath, isDev, resolveRendererEntry} from './_shared'

export class AgentWindow {
    private window: BrowserWindow | null = null

    get instance(): BrowserWindow | null {
        return this.window
    }

    open(): BrowserWindow {
        if (this.window && !this.window.isDestroyed()) {
            this.window.show()
            this.window.focus()
            return this.window
        }

        this.window = new BrowserWindow({
            width: 1180,
            height: 800,
            minWidth: 920,
            minHeight: 600,
            icon: appIconPath,
            title: 'AI Agent',
            frame: true,
            autoHideMenuBar: true,
            show: false,
            backgroundColor: '#f7f7f8',
            webPreferences: {
                preload: join(__dirname, '../preload/agent.preload.js'),
                contextIsolation: true,
                nodeIntegration: false,
                sandbox: true,
                devTools: isDev,
            },
        })

        // 徹底移除菜單列(autoHideMenuBar 只藏不移除,Alt 還會喚出)
        this.window.setMenuBarVisibility(false)
        this.window.removeMenu()

        const entry = resolveRendererEntry('windows/agent/index.html')
        if (entry.url) this.window.loadURL(entry.url)
        else this.window.loadFile(join(__dirname, '../renderer/', entry.file!))

        this.window.once('ready-to-show', () => {
            this.window?.show()
            if (isDev) this.window?.webContents.openDevTools({mode: 'detach'})
            logger.info('Agent 窗口已開啟', 'AgentWindow')
        })

        this.window.on('closed', () => {
            this.window = null
            logger.info('Agent 窗口已關閉', 'AgentWindow')
        })

        // 外部連結走系統瀏覽器
        this.window.webContents.setWindowOpenHandler(({url}) => {
            safeOpenExternal(url)
            return {action: 'deny'}
        })

        return this.window
    }

    destroy(): void {
        this.window?.destroy()
        this.window = null
    }
}
