/**
 * AI Agent 獨立視窗(docs/19)— 跟主窗平行的獨立 BrowserWindow。
 *
 * 從側邊欄「aiAgent」入口開啟。設計沿用 MemosWindow:
 *   - 不持久化,關閉即銷毀;主窗為 parent
 *   - 獨立 preload(agent.preload.js)只暴露 electronAPI.agent + on/off(AGENT_PUSH_* 白名單)
 */

import {BrowserWindow} from 'electron'
import {join} from 'path'
import {logger} from '../utils/logger'
import {appIconPath, isDev, resolveRendererEntry} from './internal'

export class AgentWindow {
    private window: BrowserWindow | null = null

    get instance(): BrowserWindow | null {
        return this.window
    }

    /** 開啟。已開過就拉到前台 + 聚焦,不重建 */
    open(parent: BrowserWindow | null): BrowserWindow {
        if (this.window && !this.window.isDestroyed()) {
            this.window.show()
            this.window.focus()
            return this.window
        }

        this.window = new BrowserWindow({
            width: 1040,
            height: 720,
            minWidth: 720,
            minHeight: 480,
            icon: appIconPath,
            title: 'AI Agent',
            frame: true,
            autoHideMenuBar: true,
            show: false,
            backgroundColor: '#fafbfc',
            parent: parent ?? undefined,
            webPreferences: {
                preload: join(__dirname, '../preload/agent.preload.js'),
                contextIsolation: true,
                nodeIntegration: false,
                sandbox: true,
                devTools: isDev,
            },
        })

        this.window.removeMenu()

        const entry = resolveRendererEntry('windows/agent/index.html')
        if (entry.url) this.window.loadURL(entry.url)
        else this.window.loadFile(join(__dirname, '../renderer/', entry.file!))

        this.window.once('ready-to-show', () => {
            this.window?.show()
            if (isDev) this.window?.webContents.openDevTools({mode: 'detach'})
            logger.info('AI Agent 視窗已開啟', 'AgentWindow')
        })

        this.window.on('closed', () => {
            this.window = null
            logger.info('AI Agent 視窗已關閉', 'AgentWindow')
        })

        return this.window
    }

    destroy(): void {
        this.window?.destroy()
        this.window = null
    }
}
