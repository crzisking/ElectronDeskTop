/**
 * 浮球拖動 + 邊緣吸附動畫管理器。
 * 用於：electron/main/index.ts 建構後注入給 IPC ball.handlers。
 * 不用 -webkit-app-region:drag 是因為它會吞 click/contextmenu 事件。
 */

import {screen} from 'electron'
import {logger} from './utils/logger'
import type {WindowManager} from './window-manager'

export class FloatingBallManager {
  /** 拖動位置輪詢 timer */
  private dragInterval: ReturnType<typeof setInterval> | null = null

  /** 邊緣吸附動畫 timer（dispose 時要 clear） */
  private animInterval: ReturnType<typeof setInterval> | null = null

  /** 拖動時游標相對浮球左上角的偏移 */
  private dragOffset = { x: 0, y: 0 }

  /** 浮球直徑（從配置讀取） */
  private ballSize = 80

  /** dispose 後不再啟動任何動畫，避免操作已銷毀的窗口 */
  private disposed = false

  constructor(
    private readonly windowManager: WindowManager,
    private snapToEdge: boolean = true
  ) {}

  /**
   * 開始拖動。
   * 記錄初始偏移並啟動 ~60fps 位置更新 timer。
   */
  startDrag(): void {
    if (this.disposed) return
    // 防止重複啟動
    if (this.dragInterval) this.stopDrag()

    const ballWindow = this.windowManager.getFloatingBallWindow()
    if (!ballWindow) return

    const [winX, winY] = ballWindow.getPosition()
    const cursor = screen.getCursorScreenPoint()
    this.dragOffset = {
      x: cursor.x - winX,
      y: cursor.y - winY
    }

    this.dragInterval = setInterval(() => {
      this.updateBallPosition()
    }, 16)

    logger.debug(`開始拖動，偏移: (${this.dragOffset.x}, ${this.dragOffset.y})`, 'FloatingBall')
  }

  /**
   * 停止拖動，依配置觸發吸附動畫。
   * dispose 後跳過動畫，避免在已銷毀窗口上 tick。
   */
  stopDrag(): void {
    if (this.dragInterval) {
      clearInterval(this.dragInterval)
      this.dragInterval = null
    }

    if (this.snapToEdge && !this.disposed) {
      this.animateSnapToEdge()
    }

    logger.debug('停止拖動', 'FloatingBall')
  }

  /** 拖動 timer 每 tick 更新一次浮球位置（含邊界 clamp） */
  private updateBallPosition(): void {
    const ballWindow = this.windowManager.getFloatingBallWindow()
    if (!ballWindow) {
      this.stopDrag()
      return
    }

    const cursor = screen.getCursorScreenPoint()
    const { width, height } = screen.getPrimaryDisplay().workAreaSize

    let targetX = cursor.x - this.dragOffset.x
    let targetY = cursor.y - this.dragOffset.y

    // 確保浮球完全在屏幕工作區內
    targetX = Math.max(0, Math.min(targetX, width - this.ballSize))
    targetY = Math.max(0, Math.min(targetY, height - this.ballSize))

    ballWindow.setPosition(Math.round(targetX), Math.round(targetY))
  }

  /** 找最近的邊，呼叫 smoothMove 平滑移動過去 */
  private animateSnapToEdge(): void {
    const ballWindow = this.windowManager.getFloatingBallWindow()
    if (!ballWindow) return

    const [currentX, currentY] = ballWindow.getPosition()
    const { width, height } = screen.getPrimaryDisplay().workAreaSize

    const distLeft = currentX
    const distRight = width - currentX - this.ballSize
    const distTop = currentY
    const distBottom = height - currentY - this.ballSize

    const minDist = Math.min(distLeft, distRight, distTop, distBottom)

    let targetX = currentX
    let targetY = currentY

    if (minDist === distLeft) {
      targetX = 0
    } else if (minDist === distRight) {
      targetX = width - this.ballSize
    } else if (minDist === distTop) {
      targetY = 0
    } else {
      targetY = height - this.ballSize
    }

    // 20 步 × 10ms ≈ 200ms
    this.smoothMove(currentX, currentY, targetX, targetY, 20, 10)

    logger.debug(
      `邊緣吸附: (${currentX}, ${currentY}) → (${targetX}, ${targetY})`,
      'FloatingBall'
    )
  }

  /**
   * easeOut 緩動平滑移動。
   * @param fromX 起始 X
   * @param fromY 起始 Y
   * @param toX   目標 X
   * @param toY   目標 Y
   * @param steps 動畫步數
   * @param intervalMs 每步間隔毫秒
   */
  private smoothMove(
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    steps: number,
    intervalMs: number
  ): void {
    if (this.disposed) return

    const ballWindow = this.windowManager.getFloatingBallWindow()
    if (!ballWindow) return

    // 清掉舊動畫避免重疊
    if (this.animInterval) {
      clearInterval(this.animInterval)
      this.animInterval = null
    }

    let step = 0
    this.animInterval = setInterval(() => {
      // dispose 或窗口銷毀後主動停止
      const win = this.windowManager.getFloatingBallWindow()
      if (this.disposed || !win || win.isDestroyed()) {
        if (this.animInterval) {
          clearInterval(this.animInterval)
          this.animInterval = null
        }
        return
      }

      step++
      if (step >= steps) {
        clearInterval(this.animInterval!)
        this.animInterval = null
        win.setPosition(Math.round(toX), Math.round(toY))
        return
      }

      // easeOut: position = from + (to-from) * (1-(1-t)^2)
      const t = step / steps
      const ease = 1 - Math.pow(1 - t, 2)
      const x = Math.round(fromX + (toX - fromX) * ease)
      const y = Math.round(fromY + (toY - fromY) * ease)
      win.setPosition(x, y)
    }, intervalMs)
  }

  /**
   * 釋放 timer 並標記 disposed。
   * 用於：app before-quit、UpdateManager.quitAndInstall 前清理。
   * dispose 後再呼叫 startDrag/smoothMove 都會立即返回。
   */
  dispose(): void {
    this.disposed = true
    if (this.dragInterval) {
      clearInterval(this.dragInterval)
      this.dragInterval = null
    }
    if (this.animInterval) {
      clearInterval(this.animInterval)
      this.animInterval = null
    }
    logger.debug('FloatingBallManager 已釋放', 'FloatingBall')
  }

  /** 配置熱更新時呼叫 */
  setSnapToEdge(snap: boolean): void {
    this.snapToEdge = snap
  }

  /** 配置熱更新時呼叫 */
  setBallSize(size: number): void {
    this.ballSize = size
  }
}
