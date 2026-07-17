/**
 * 桌面代辦 · 頂部 dock 窗(docs/23 §3)。
 *
 * **固定尺寸的透明穿透窗 + CSS 動畫**(不做窗口縮放):
 *   - 窗口一直是「主螢幕頂部、滿寬、固定高」的全透明置頂窗,平時 **setIgnoreMouseEvents(true,{forward:true})**
 *     → 完全看不見、點擊穿透(不擋任何東西),但 renderer 仍收得到 forward 的 mousemove 以偵測「滑到頂部」。
 *   - renderer 用整窗 mousemove 判斷:滑到頂部正中一小段 → 送 TODO_DOCK_SET_INTERACTIVE(true) 轉為可交互,
 *     面板用 CSS transform 平滑滑下;滑鼠離開面板 → 送 false 恢復穿透、面板滑回。
 *   - 動畫在 renderer 用 CSS(窗口不縮放)→ 連續、無 px 尺寸提示、內容完整。
 *   - focusable:false 不搶焦點;開機常駐。
 */

import {BrowserWindow, screen} from 'electron'
import {join} from 'path'
import {logger} from '../utils/logger'
import {isDev, resolveRendererEntry} from './internal'

/** 固定窗高:容得下展開後的面板(其餘透明穿透) */
const DOCK_HEIGHT = 480

export class TodoDockWindow {
    private window: BrowserWindow | null = null

    get instance(): BrowserWindow | null {
        return this.window
    }

    create(): BrowserWindow {
        if (this.window && !this.window.isDestroyed()) return this.window

        const {x, y, width} = screen.getPrimaryDisplay().workArea

        this.window = new BrowserWindow({
            x,
            y,
            width,
            height: DOCK_HEIGHT,
            frame: false,
            transparent: true,
            backgroundColor: '#00000000',
            resizable: false,
            movable: false,
            minimizable: false,
            maximizable: false,
            fullscreenable: false,
            skipTaskbar: true,
            alwaysOnTop: true,
            focusable: false,
            show: false,
            hasShadow: false,
            webPreferences: {
                preload: join(__dirname, '../preload/todo-dock.preload.js'),
                contextIsolation: true,
                nodeIntegration: false,
                sandbox: true,
                devTools: isDev,
            },
        })

        this.window.removeMenu()
        this.window.setAlwaysOnTop(true, 'pop-up-menu')
        // 平時:全透明 + 穿透(forward 讓 renderer 仍收 mousemove)
        this.window.setIgnoreMouseEvents(true, {forward: true})

        const entry = resolveRendererEntry('windows/todo-dock/index.html')
        if (entry.url) this.window.loadURL(entry.url)
        else this.window.loadFile(join(__dirname, '../renderer/', entry.file!))

        this.window.once('ready-to-show', () => {
            this.window?.showInactive()
            logger.info('代辦 dock 窗已開啟', 'TodoDockWindow')
        })

        this.window.on('closed', () => {
            this.window = null
        })

        return this.window
    }

    /** 懸停在面板上 → 可交互;離開 → 穿透 */
    setInteractive(on: boolean): void {
        if (!this.window || this.window.isDestroyed()) return
        if (on) this.window.setIgnoreMouseEvents(false)
        else this.window.setIgnoreMouseEvents(true, {forward: true})
    }

    destroy(): void {
        this.window?.destroy()
        this.window = null
    }
}
