/**
 * 桌面代辦 · 錄入小窗(docs/23 鐵律一「錄入永遠只有一句話」)。
 *
 * 全域快捷鍵(Ctrl+/)喚起的 Spotlight 式單行輸入窗:無邊框、置頂、不進工作列。
 *   - 首次建立後**只 hide 不 destroy**(快捷鍵要瞬間出現;重建 BrowserWindow 太慢)。
 *   - 跟靈感速記 / agent 一樣**不設 parent**(避免跟主窗一起最小化)。
 *   - 不做失焦自動隱藏:P4 語音(Win+H)會讓本窗短暫失焦,失焦即隱會打斷語音錄入;
 *     故只在 Esc / 保存成功 時由 renderer 送 TODO_HIDE_CAPTURE 隱藏。
 */

import {BrowserWindow} from 'electron'
import {join} from 'path'
import {logger} from '../utils/logger'
import {appIconPath, isDev, resolveRendererEntry} from './internal'
import {triggerWindowsVoice} from '../todo/voice'

export class TodoCaptureWindow {
    private window: BrowserWindow | null = null
    /** 本窗是否已喚起系統語音(Win+H)—— 關窗時據此把它一起關掉(Win+H 是開關鍵) */
    private voiceOpen = false

    get instance(): BrowserWindow | null {
        return this.window
    }

    /** 喚起:建好就 show+focus+置中;沒建過才 create */
    open(): BrowserWindow {
        if (this.window && !this.window.isDestroyed()) {
            this.window.center()
            this.window.show()
            this.window.focus()
            this.scheduleVoice()
            return this.window
        }

        this.window = new BrowserWindow({
            width: 600,
            height: 96,
            icon: appIconPath,
            title: '快速記錄',
            frame: false,
            resizable: false,
            alwaysOnTop: true,
            skipTaskbar: true,
            show: false,
            center: true,
            transparent: true,
            backgroundColor: '#00000000',
            webPreferences: {
                preload: join(__dirname, '../preload/todo-capture.preload.js'),
                contextIsolation: true,
                nodeIntegration: false,
                sandbox: true,
                devTools: isDev,
            },
        })

        this.window.removeMenu()

        const entry = resolveRendererEntry('windows/todo-capture/index.html')
        if (entry.url) this.window.loadURL(entry.url)
        else this.window.loadFile(join(__dirname, '../renderer/', entry.file!))

        this.window.once('ready-to-show', () => {
            this.window?.show()
            this.window?.focus()
            this.scheduleVoice()
            if (isDev) this.window?.webContents.openDevTools({mode: 'detach'})
            logger.info('代辦錄入窗已開啟', 'TodoCaptureWindow')
        })

        this.window.on('closed', () => {
            this.window = null
        })

        // 失焦兜底:使用者若去點語音面板(如點它的 ×)手動關掉,本窗會失焦 →
        // 清掉 voiceOpen 標記,避免之後關窗時又按一次 Win+H 把面板重新彈出(孤兒窗)。
        // 正常語音輸入不搶本窗焦點,故不影響「說完 Enter 一起關」。
        this.window.on('blur', () => {
            this.voiceOpen = false
        })

        return this.window
    }

    /** 🎤 按鈕:開/關切換 */
    toggleVoice(): void {
        if (this.voiceOpen) this.closeVoiceIfOpen()
        else this.openVoice()
    }

    /** 隱藏(不銷毀)—— 連同語音面板一起收 */
    hide(): void {
        this.closeVoiceIfOpen()
        if (this.window && !this.window.isDestroyed() && this.window.isVisible()) this.window.hide()
    }

    destroy(): void {
        this.window?.destroy()
        this.window = null
    }

    /**
     * 開窗後自動拉起系統語音輸入(Win+H)—— 對齊「快捷鍵同時拉起輸入 + 語音」的設計。
     * 延遲一拍確保本窗已前台聚焦,語音才會打進本窗的 input。
     */
    private scheduleVoice(): void {
        setTimeout(() => this.openVoice(), 300)
    }

    private openVoice(): void {
        triggerWindowsVoice()
        this.voiceOpen = true
    }

    /** 若語音面板是本窗開的 → 再按一次 Win+H 關掉 */
    private closeVoiceIfOpen(): void {
        if (this.voiceOpen) {
            triggerWindowsVoice()
            this.voiceOpen = false
        }
    }
}
