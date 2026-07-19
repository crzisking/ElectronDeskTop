/**
 * 桌面代辦 · 錄入小窗(docs/23 鐵律一「錄入永遠只有一句話」)。
 *
 * 全域快捷鍵(Ctrl+/)喚起的 Spotlight 式單行輸入窗:無邊框、置頂、不進工作列。
 *   - 首次建立後**只 hide 不 destroy**(快捷鍵要瞬間出現;重建 BrowserWindow 太慢)。
 *   - 跟靈感速記 / agent 一樣**不設 parent**(避免跟主窗一起最小化)。
 *
 * 語音(Win+H)策略 —— **拉起就撒手,絕不代關**:
 *   Win+H 是**無狀態開關鍵**(系統不提供「查詢語音是否開著」的 API)。若在關窗時再按一次
 *   Win+H 想收語音,一旦語音早已被 Esc / 系統關掉,這一下反而會把它**重新開出來**。
 *   故本窗**只負責拉起語音一次,之後完全不管它** —— 語音由使用者 / 系統自己關(按 Esc 即關語音)。
 *   我方只確保:①顯示時輸入框游標在位;②Esc / 回車 / 點窗外 都能關掉**輸入框**(不發任何 Win+H)。
 *
 *   焦點順序(避免游標不在 input):顯示窗口後不盲等拉語音,而是推 `TODO_CAPTURE_SHOWN`
 *   給渲染層 → 渲染層**先聚焦 input 再拉 Win+H**,保證語音打進輸入框、游標在位。
 *
 *   點窗外自動關:失焦即 hide()。但顯示 / 拉 Win+H 這段本窗會短暫失焦,故 grace 期
 *   (見 ignoreBlurUntil)內的 blur 一律忽略,只有 grace 之後才算「點窗外」。
 */

import {BrowserWindow} from 'electron'
import {join} from 'path'
import {IpcChannels} from '../../shared/ipc-channels'
import {logger} from '../utils/logger'
import {appIconPath, isDev, resolveRendererEntry} from './internal'
import {triggerWindowsVoice} from '../todo/voice'

export class TodoCaptureWindow {
    private window: BrowserWindow | null = null
    /** 顯示 / 拉語音那段本窗會短暫失焦;在此時間戳(ms)前的 blur 一律忽略 */
    private ignoreBlurUntil = 0

    get instance(): BrowserWindow | null {
        return this.window
    }

    /** 喚起:建好就 show+focus;沒建過才 create */
    open(): BrowserWindow {
        if (this.window && !this.window.isDestroyed()) {
            this.prepareShow()
            this.window.center()
            this.window.show()
            this.window.moveTop()
            this.window.focus()
            this.window.webContents.focus()
            // 已存在的窗:渲染層早已掛載訂閱 → 推「已顯示」,由它先聚焦 input 再拉語音
            this.window.webContents.send(IpcChannels.TODO_CAPTURE_SHOWN)
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
            this.prepareShow()
            this.window?.show()
            this.window?.moveTop()
            this.window?.focus()
            this.window?.webContents.focus()
            if (isDev) this.window?.webContents.openDevTools({mode: 'detach'})
            // 首次:稍等一拍再推,確保渲染層 onMounted 的訂閱已就緒(否則首開收不到 → 沒語音)
            setTimeout(() => this.window?.webContents.send(IpcChannels.TODO_CAPTURE_SHOWN), 120)
            logger.info('代辦錄入窗已開啟', 'TodoCaptureWindow')
        })

        this.window.on('closed', () => {
            this.window = null
        })

        // 點窗外自動關:失焦即隱藏輸入窗(不碰語音;語音自己關)。
        // grace 期內的失焦(= 顯示 / 拉 Win+H 造成的短暫失焦)忽略,否則一拉起就被自己關掉。
        this.window.on('blur', () => {
            if (Date.now() < this.ignoreBlurUntil) return
            this.hide()
        })

        return this.window
    }

    /** 🎤 按鈕 / 渲染層自動:拉起系統語音(Win+H)。拉起即撒手,不追蹤、不代關 */
    triggerVoice(): void {
        triggerWindowsVoice()
        // 拉起 Win+H 的瞬間本窗會短暫失焦 → 續一段 grace,只有 grace 之後的失焦才算「點窗外」
        this.ignoreBlurUntil = Date.now() + 1200
    }

    /** 隱藏(不銷毀)—— 只收輸入窗,**不碰語音面板**(Win+H 無狀態,代關會誤觸重開;語音自己關) */
    hide(): void {
        if (this.window && !this.window.isDestroyed() && this.window.isVisible()) this.window.hide()
    }

    destroy(): void {
        this.window?.destroy()
        this.window = null
    }

    /** 每次顯示前:給一段 grace 吞掉顯示 / 聚焦 / 拉語音時的短暫失焦(避免一拉起就被自己關) */
    private prepareShow(): void {
        this.ignoreBlurUntil = Date.now() + 1500
    }
}
