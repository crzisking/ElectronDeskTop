/**
 * 備忘錄子視窗 — 跟主窗平行的獨立 BrowserWindow,使用者頻繁切回記快速筆記。
 *
 * 對齊 docs/20 §5.5 + user 反饋:備忘錄不該嵌在主窗主流程內,獨立窗口讓使用者
 * 隨手叫出 / 收起,類似桌面便利貼。
 *
 * 設計沿用 LogViewerWindow:
 *   - 不持久化,關閉即銷毀
 *   - 主窗為 parent,主窗最小化時跟著消失
 *   - 獨立 preload(memos.preload.js)只暴露 projectFlow IPC 子集
 */

import {BrowserWindow} from 'electron'
import {join} from 'path'
import {logger} from '../utils/logger'
import {appIconPath, isDev, resolveRendererEntry} from './internal'

export class MemosWindow {
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
            width: 900,
            height: 640,
            minWidth: 600,
            minHeight: 400,
            icon: appIconPath,
            title: '備忘錄',
            frame: true,
            // 隱藏 Windows 原生選單列(File/Edit 那行)— 備忘錄是便利貼,不需要選單
            autoHideMenuBar: true,
            show: false,
            backgroundColor: '#fafbfc',
            // 主窗的子視窗,主窗最小化時跟著消失
            parent: parent ?? undefined,
            webPreferences: {
                preload: join(__dirname, '../preload/memos.preload.js'),
                contextIsolation: true,
                nodeIntegration: false,
                sandbox: true,
                devTools: isDev,
            },
        })

        // autoHideMenuBar 只是隱藏(按 Alt 還會冒出來);整個移除才乾淨
        this.window.removeMenu()

        const entry = resolveRendererEntry('windows/memos/index.html')
        if (entry.url) this.window.loadURL(entry.url)
        else this.window.loadFile(join(__dirname, '../renderer/', entry.file!))

        this.window.once('ready-to-show', () => {
            this.window?.show()
            if (isDev) this.window?.webContents.openDevTools({mode: 'detach'})
            logger.info('備忘錄視窗已開啟', 'MemosWindow')
        })

        this.window.on('closed', () => {
            this.window = null
            logger.info('備忘錄視窗已關閉', 'MemosWindow')
        })

        return this.window
    }

    destroy(): void {
        this.window?.destroy()
        this.window = null
    }
}
