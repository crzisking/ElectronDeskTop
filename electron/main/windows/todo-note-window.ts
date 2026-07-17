/**
 * 桌面代辦 · 備注編輯小窗(docs/23 鐵律三「編輯是卡片,不是表單」的補位)。
 *
 * dock 窗 focusable:false 不能打字,備注這種需要輸入的欄位改由本可聚焦小窗承擔:
 *   - 從 dock 卡片「備注」入口開啟,帶當前代辦 id(存在 this.targetId)。
 *   - renderer 載入後查 TODO_NOTE_TARGET 拿 {id,title,note} 回填,Enter/Ctrl+Enter 存、Esc 關。
 *   - 保存走既有 TODO_PATCH{note};關窗只 hide 不 destroy(下次更快)。
 * 設計沿用 TodoCaptureWindow:無邊框、透明、置頂、不進工作列、不設 parent;差別是**可聚焦**(要打字)。
 */

import {BrowserWindow} from 'electron'
import {join} from 'path'
import {logger} from '../utils/logger'
import {appIconPath, isDev, resolveRendererEntry} from './internal'

export class TodoNoteWindow {
    private window: BrowserWindow | null = null
    /** 當前正在編輯備注的代辦 id;renderer 用 TODO_NOTE_TARGET 來查 */
    private targetId = ''

    get instance(): BrowserWindow | null {
        return this.window
    }

    /** 當前編輯目標 id(handler 查目標資料時用) */
    get currentTargetId(): string {
        return this.targetId
    }

    /** 開啟並綁定編輯目標;已建過就換目標 + 拉到前台 */
    open(id: string): BrowserWindow {
        this.targetId = id

        if (this.window && !this.window.isDestroyed()) {
            this.window.center()
            this.window.show()
            this.window.focus()
            // 已存在的窗:通知 renderer 重新載入目標(換了另一條代辦的備注)
            this.window.webContents.send('todo:note-target-changed')
            return this.window
        }

        this.window = new BrowserWindow({
            width: 520,
            height: 260,
            icon: appIconPath,
            title: '備注',
            frame: false,
            resizable: false,
            alwaysOnTop: true,
            skipTaskbar: true,
            show: false,
            center: true,
            transparent: true,
            backgroundColor: '#00000000',
            webPreferences: {
                preload: join(__dirname, '../preload/todo-note.preload.js'),
                contextIsolation: true,
                nodeIntegration: false,
                sandbox: true,
                devTools: isDev,
            },
        })

        this.window.removeMenu()

        const entry = resolveRendererEntry('windows/todo-note/index.html')
        if (entry.url) this.window.loadURL(entry.url)
        else this.window.loadFile(join(__dirname, '../renderer/', entry.file!))

        this.window.once('ready-to-show', () => {
            this.window?.show()
            this.window?.focus()
            logger.info('代辦備注窗已開啟', 'TodoNoteWindow')
        })

        this.window.on('closed', () => {
            this.window = null
        })

        return this.window
    }

    /** 隱藏(不銷毀) */
    hide(): void {
        if (this.window && !this.window.isDestroyed() && this.window.isVisible()) this.window.hide()
    }

    destroy(): void {
        this.window?.destroy()
        this.window = null
    }
}
