/**
 * 桌面代辦 · 頂部 dock 窗(docs/23 §3)。
 *
 * **透明穿透窗 + CSS 動畫,idle 時窗體縮成頂部細條**:
 *   - 常駐「主螢幕頂部、滿寬」的全透明置頂窗,平時 **setIgnoreMouseEvents(true,{forward:true})**
 *     → 完全看不見、點擊穿透(不擋任何東西),但 renderer 仍收得到 forward 的 mousemove 以偵測「滑到頂部」。
 *   - **idle 時窗高只有 IDLE_HEIGHT(細條)** —— 常駐透明置頂窗無法被遮擋剔除,GPU 得一直合成它;
 *     窗越大合成面積越大(核顯機閒置也吃 GPU)。故平時只保留「夠偵測游標貼頂」的細條,hover 才長到
 *     EXPANDED_HEIGHT 讓面板有空間滑下;離開後再縮回。合成面積從「滿寬×480 常駐」降到「滿寬×細條」。
 *   - 縮放時序在 setInteractive 內處理:展開**先長高再讓面板滑下**;收起**先讓面板 CSS 滑回、延遲到動畫
 *     結束再縮窗**(否則窗一縮面板被裁掉而非平滑滑上)。動畫本身仍在 renderer 用 CSS(窗高瞬間變,不參與動畫)。
 *   - focusable:false 不搶焦點;開機常駐。
 */

import {BrowserWindow, screen} from 'electron'
import {join} from 'path'
import {logger} from '../utils/logger'
import {isDev, resolveRendererEntry} from './internal'

/** 展開窗高:容得下展開後的面板(其餘透明穿透) */
const EXPANDED_HEIGHT = 480
/** idle 窗高:只需容納「游標貼頂」偵測(renderer TRIGGER_Y=6);其餘畫面留給下方 app */
const IDLE_HEIGHT = 8
/** 收起後延遲縮窗的毫秒數:須 ≥ 面板 CSS 滑回時間(transform 240ms),否則縮窗會截斷滑回動畫 */
const COLLAPSE_SHRINK_DELAY = 280

export class TodoDockWindow {
    private window: BrowserWindow | null = null
    /** 收起後的延遲縮窗 timer(展開會取消它,避免收/展快速切換時把剛長高的窗縮掉) */
    private shrinkTimer: ReturnType<typeof setTimeout> | null = null

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
            height: IDLE_HEIGHT,
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

    /**
     * 懸停在面板上 → 可交互 + 窗長高;離開 → 穿透 + 延遲縮回細條。
     * 展開先長高(面板才有空間滑下),收起延遲縮窗(等 CSS 滑回動畫跑完再縮,不截斷動畫)。
     */
    setInteractive(on: boolean): void {
        if (!this.window || this.window.isDestroyed()) return
        if (on) {
            if (this.shrinkTimer) {
                clearTimeout(this.shrinkTimer)
                this.shrinkTimer = null
            }
            this.setHeight(EXPANDED_HEIGHT)          // 先長高,面板才有空間滑下
            this.window.setIgnoreMouseEvents(false)
        } else {
            this.window.setIgnoreMouseEvents(true, {forward: true})
            if (this.shrinkTimer) clearTimeout(this.shrinkTimer)
            this.shrinkTimer = setTimeout(() => {
                this.shrinkTimer = null
                this.setHeight(IDLE_HEIGHT)          // 等面板 CSS 滑回結束再縮窗
            }, COLLAPSE_SHRINK_DELAY)
        }
    }

    /** 調整窗高並維持頂部滿寬對齊(每次重取 workArea,顯示器/工作列變動時自動跟上) */
    private setHeight(height: number): void {
        if (!this.window || this.window.isDestroyed()) return
        const {x, y, width} = screen.getPrimaryDisplay().workArea
        this.window.setBounds({x, y, width, height})
    }

    destroy(): void {
        if (this.shrinkTimer) {
            clearTimeout(this.shrinkTimer)
            this.shrinkTimer = null
        }
        this.window?.destroy()
        this.window = null
    }
}
