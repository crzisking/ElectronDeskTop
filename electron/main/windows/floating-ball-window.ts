/**
 * 浮球窗口 — 主窗隱藏後的代用入口。
 *
 * 特點:
 *  - 透明 + 無邊框 + alwaysOnTop + 不可調整大小
 *  - 應用生命週期內持久存在,只切 show/hide,不銷毀
 *  - setFloatingBallPosition 內含跨顯示器邊界 fallback(拔螢幕時不會塞屏外)
 */

import {BrowserWindow, screen} from 'electron'
import {join} from 'path'
import {logger} from '../utils/logger'
import {resolveRendererEntry} from './internal'

export class FloatingBallWindow {
    private window: BrowserWindow | null = null

    get instance(): BrowserWindow | null {
        return this.window
    }

    create(): BrowserWindow {
        // 視窗緊貼球體外接正方形(80×80),不留 padding —— 已去掉 box-shadow,
        // 同時最小化四角透明區,拖動時 Windows DWM 不會把多餘透明矩形描出來
        this.window = new BrowserWindow({
            width: 80,
            height: 80,
            frame: false,
            transparent: true,
            alwaysOnTop: true,
            skipTaskbar: true,
            resizable: false,
            hasShadow: false,
            show: false,
            focusable: false,
            webPreferences: {
                preload: join(__dirname, '../preload/floatingBall.js'),
                contextIsolation: true,
                nodeIntegration: false,
                sandbox: true,
            },
        })

        // Windows 用 screen-saver 級別防被全屏窗口遮擋
        if (process.platform === 'win32') {
            this.window.setAlwaysOnTop(true, 'screen-saver')
        } else if (process.platform === 'darwin') {
            this.window.setAlwaysOnTop(true, 'floating')
        }

        const entry = resolveRendererEntry('windows/floating-ball/index.html')
        if (entry.url) this.window.loadURL(entry.url)
        else this.window.loadFile(join(__dirname, '../renderer/', entry.file!))

        this.window.once('ready-to-show', () => {
            logger.info('浮球窗口已就緒', 'FloatingBallWindow')
        })

        logger.info('浮球窗口已創建', 'FloatingBallWindow')
        return this.window
    }

    show(): void {
        this.window?.show()
    }

    hide(): void {
        this.window?.hide()
    }

    /** 取浮球當前位置(屏幕座標) */
    getPosition(): { x: number; y: number } {
        if (!this.window) return {x: 100, y: 300}
        const [x, y] = this.window.getPosition()
        return {x, y}
    }

    /**
     * 設置浮球位置(會校驗顯示器邊界)。
     *
     * 邊界校驗:
     *  1. (x, y) 落在某 display.workArea 內 → 該 display 內 clamp(防邊緣輕微越界)
     *  2. 都不在(拔副屏場景)→ 主屏右下角離邊 80px,避免首次顯示在屏外瞬閃
     */
    setPosition(x: number, y: number, ballSize = 80): void {
        if (!this.window) return

        const displays = screen.getAllDisplays()
        const containing = displays.find((d) => {
            const {x: dx, y: dy, width: dw, height: dh} = d.workArea
            return x >= dx && x <= dx + dw - ballSize && y >= dy && y <= dy + dh - ballSize
        })

        if (containing) {
            const {x: dx, y: dy, width: dw, height: dh} = containing.workArea
            const clampedX = Math.max(dx, Math.min(x, dx + dw - ballSize))
            const clampedY = Math.max(dy, Math.min(y, dy + dh - ballSize))
            this.window.setPosition(clampedX, clampedY)
            return
        }

        // 拔顯示器 fallback:塞主屏右下角
        const primary = screen.getPrimaryDisplay().workArea
        const fallbackX = primary.x + primary.width - ballSize - 80
        const fallbackY = primary.y + primary.height - ballSize - 80
        logger.warn(
            `浮球默認位置 (${x}, ${y}) 不在任何顯示器內,改塞主屏右下角 (${fallbackX}, ${fallbackY})`,
            'FloatingBallWindow',
        )
        this.window.setPosition(fallbackX, fallbackY)
    }

    destroy(): void {
        this.window?.destroy()
        this.window = null
    }
}
