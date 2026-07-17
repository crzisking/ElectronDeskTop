/**
 * WindowManager — 3 種窗口的統一外觀(thin shell)。
 *
 * 內部委派給 main / floating-ball / log-viewer / child 四個 class / factory,
 * 對外 API 保持跟舊版一致,讓 IPC handler / TrayManager / UpdateManager 不用改 import。
 *
 * 狀態機:主窗顯示 ←→ 主窗隱藏 + 浮球顯示。
 *
 * 設計變更紀錄:
 *   原本有 AgentWindow,Agent 功能整套移除後(改規劃由 pi/piagent 重寫,
 *   見 docs/19),這層也跟著拿掉。Agent v2 上線時會再加回來。
 */

import {BrowserWindow} from 'electron'
import {logger} from '../utils/logger'
import {MainWindow} from './main-window'
import {FloatingBallWindow} from './floating-ball-window'
import {LogViewerWindow} from './log-viewer-window'
import {AgentWindow} from './agent-window'
import {IdeaCaptureWindow} from './idea-capture-window'
import {TodoCaptureWindow} from './todo-capture-window'
import {TodoDockWindow} from './todo-dock-window'
import {openChildWindow} from './child-window'

export class WindowManager {
    private main = new MainWindow()
    private floatingBall = new FloatingBallWindow()
    private logViewer = new LogViewerWindow()
    private agent = new AgentWindow()
    private ideaCapture = new IdeaCaptureWindow()
    private todoCapture = new TodoCaptureWindow()
    private todoDock = new TodoDockWindow()

    // ── 退出標記 ────────────────────────────────────────────────────
    setQuitting(value: boolean): void {
        this.main.setQuitting(value)
    }

    // ── 建構(boot 階段呼叫一次)────────────────────────────────────
    createMainWindow(): BrowserWindow {
        return this.main.create()
    }

    createFloatingBallWindow(): BrowserWindow {
        return this.floatingBall.create()
    }

    // ── 按需建構(IPC / 浮球菜單觸發)───────────────────────────────
    createLogViewerWindow(): BrowserWindow {
        return this.logViewer.open(this.main.instance)
    }

    /** 開啟 AI Agent 獨立窗(docs/19);已開過就 focus,不重建 */
    createAgentWindow(): BrowserWindow {
        return this.agent.open()
    }

    /** AI Agent 子視窗(串流 push 廣播 / focus 用) */
    getAgentWindow(): BrowserWindow | null {
        return this.agent.instance
    }

    /** 開啟靈感速記小窗(docs/21);已開過就 show+focus,不重建(保留草稿) */
    createIdeaCaptureWindow(): BrowserWindow {
        return this.ideaCapture.open()
    }

    /** 靈感速記小窗實例(隱藏 / 保存後關窗用) */
    getIdeaCaptureWindow(): IdeaCaptureWindow {
        return this.ideaCapture
    }

    /** 開啟代辦錄入小窗(docs/23);已開過就 show+focus,不重建 */
    createTodoCaptureWindow(): BrowserWindow {
        return this.todoCapture.open()
    }

    /** 代辦錄入小窗實例(保存 / Esc 後隱藏用) */
    getTodoCaptureWindow(): TodoCaptureWindow {
        return this.todoCapture
    }

    /** 建立代辦頂部 dock 窗(docs/23);開機常駐,呼叫一次 */
    createTodoDockWindow(): BrowserWindow {
        return this.todoDock.create()
    }

    /** 代辦 dock 窗實例(懸停切穿透用) */
    getTodoDockWindow(): TodoDockWindow {
        return this.todoDock
    }

    // ── 主窗 ↔ 浮球 切換 ────────────────────────────────────────────
    showMainWindow(): void {
        this.main.show()
        this.floatingBall.hide()
        logger.debug('顯示主窗口,隱藏浮球', 'WindowManager')
    }

    hideMainWindow(): void {
        this.main.hide()
        this.floatingBall.show()
        logger.debug('隱藏主窗口,顯示浮球', 'WindowManager')
    }

    showFloatingBall(): void {
        this.floatingBall.show()
    }

    hideFloatingBall(): void {
        this.floatingBall.hide()
    }

    // ── BrowserWindow 引用(IPC handler 拿來 send / focus)─────────
    getMainWindow(): BrowserWindow | null {
        return this.main.instance
    }

    getFloatingBallWindow(): BrowserWindow | null {
        return this.floatingBall.instance
    }

    /**
     * LogViewer 子視窗(密碼保護)。
     * 階段二後 LogViewer 內嵌工作採集 tab,寫入完成事件需要也推給它,
     * 否則 LogViewer 打開時看到的流水線不會自動 refresh。
     */
    getLogViewerWindow(): BrowserWindow | null {
        return this.logViewer.instance
    }

    // ── 跨進程通訊 ─────────────────────────────────────────────────
    sendToMainWindow(channel: string, ...args: unknown[]): void {
        this.main.send(channel, ...args)
    }

    /**
     * 廣播給「會看採集紀錄」的所有 renderer。
     * 目前:主窗(永遠跑 store.bootstrap('main'))+ LogViewer(打開時跑 viewer mode)。
     * LogViewer 沒開就跳過,不會報錯。
     */
    broadcastToWorkRecordViewers(channel: string, ...args: unknown[]): void {
        const main = this.getMainWindow()
        if (main && !main.isDestroyed()) main.webContents.send(channel, ...args)
        const lv = this.getLogViewerWindow()
        if (lv && !lv.isDestroyed()) lv.webContents.send(channel, ...args)
    }

    // ── 浮球位置(FloatingBallManager 用)────────────────────────
    getFloatingBallPosition(): { x: number; y: number } {
        return this.floatingBall.getPosition()
    }

    setFloatingBallPosition(x: number, y: number, ballSize = 80): void {
        this.floatingBall.setPosition(x, y, ballSize)
    }

    // ── 通用子窗口(unified-platform 開外部 URL 用)─────────────
    openChildWindow(url: string, title: string, allowedDomains: string[] = []): BrowserWindow {
        return openChildWindow(url, title, allowedDomains)
    }

    // ── 退出時銷毀全部 ─────────────────────────────────────────
    destroyAll(): void {
        this.todoDock.destroy()
        this.todoCapture.destroy()
        this.ideaCapture.destroy()
        this.agent.destroy()
        this.logViewer.destroy()
        this.floatingBall.destroy()
        this.main.destroy()
    }
}
