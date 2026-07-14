/**
 * 靈感速記速記小窗(docs/21 §3.1)。
 *
 * 全域快捷鍵喚起的 Spotlight 式小窗:無邊框、置頂、不進工作列、失焦即隱藏。
 *   - **首次建立後只 hide 不 destroy** —— 快捷鍵要瞬間出現,重建 BrowserWindow 太慢;
 *     順帶讓「保存失敗的草稿」留在窗內。
 *   - ⚠️ 跟 agent 視窗一樣**不設 parent**(子視窗會跟主窗一起最小化)。
 *   - 隱藏走 Esc / 保存成功 / × 按鈕(renderer 送 IDEA_HIDE_CAPTURE),**不做失焦自動隱藏**:
 *     附件走 <input type=file> 會開原生對話框讓小窗失焦,且失焦即毀會丟半截草稿,得不償失。
 */

import {BrowserWindow} from 'electron'
import {join} from 'path'
import {logger} from '../utils/logger'
import {appIconPath, isDev, resolveRendererEntry} from './internal'

export class IdeaCaptureWindow {
    private window: BrowserWindow | null = null

    get instance(): BrowserWindow | null {
        return this.window
    }

    /** 喚起:建好就 show+focus+置中;沒建過才 create */
    open(): BrowserWindow {
        if (this.window && !this.window.isDestroyed()) {
            this.window.center()
            this.window.show()
            this.window.focus()
            return this.window
        }

        this.window = new BrowserWindow({
            width: 560,
            height: 520,
            minWidth: 460,
            minHeight: 420,
            icon: appIconPath,
            title: '靈感速記',
            frame: false,
            resizable: true,
            alwaysOnTop: true,
            skipTaskbar: true,
            show: false,
            center: true,
            backgroundColor: '#ffffff',
            // 不設 parent —— 獨立視窗(見檔頂註解)
            webPreferences: {
                preload: join(__dirname, '../preload/idea-capture.preload.js'),
                contextIsolation: true,
                nodeIntegration: false,
                sandbox: true,
                devTools: isDev,
            },
        })

        this.window.removeMenu()

        const entry = resolveRendererEntry('windows/idea-capture/index.html')
        if (entry.url) this.window.loadURL(entry.url)
        else this.window.loadFile(join(__dirname, '../renderer/', entry.file!))

        this.window.once('ready-to-show', () => {
            this.window?.show()
            this.window?.focus()
            if (isDev) this.window?.webContents.openDevTools({mode: 'detach'})
            logger.info('靈感速記視窗已開啟', 'IdeaCaptureWindow')
        })

        this.window.on('closed', () => {
            this.window = null
        })

        return this.window
    }

    /** 隱藏(不銷毀,保留草稿) */
    hide(): void {
        if (this.window && !this.window.isDestroyed() && this.window.isVisible()) this.window.hide()
    }

    destroy(): void {
        this.window?.destroy()
        this.window = null
    }
}
