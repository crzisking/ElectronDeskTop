/**
 * WindowManager — 4 種窗口的統一外觀(thin shell)。
 *
 * 內部委派給 main / floating-ball / log-viewer / agent / child 五個 class / factory,
 * 對外 API 保持跟舊版一致,讓 IPC handler / TrayManager / UpdateManager 不用改 import。
 *
 * 狀態機:主窗顯示 ←→ 主窗隱藏 + 浮球顯示。
 */

import {BrowserWindow} from 'electron'
import {logger} from '../utils/logger'
import {MainWindow} from './main-window'
import {FloatingBallWindow} from './floating-ball-window'
import {LogViewerWindow} from './log-viewer-window'
import {AgentWindow} from './agent-window'
import {openChildWindow} from './child-window'

export class WindowManager {
    private main = new MainWindow()
    private floatingBall = new FloatingBallWindow()
    private logViewer = new LogViewerWindow()
    private agent = new AgentWindow()

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

    createAgentWindow(): BrowserWindow {
        return this.agent.open()
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

    getAgentWindow(): BrowserWindow | null {
        return this.agent.instance
    }

    // ── 跨進程通訊 ─────────────────────────────────────────────────
    sendToMainWindow(channel: string, ...args: unknown[]): void {
        this.main.send(channel, ...args)
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
        this.agent.destroy()
        this.logViewer.destroy()
        this.floatingBall.destroy()
        this.main.destroy()
    }
}
