/**
 * 浮球拖動管理器
 *
 * 負責浮球窗口的拖動邏輯和邊緣吸附動畫。
 *
 * 拖動原理：
 *  1. 渲染進程在 mousedown 時發送 BALL_START_DRAG 到主進程
 *  2. 主進程記錄拖動偏移量（游標位置 - 窗口位置）
 *  3. 以 ~60fps 的間隔輪詢 screen.getCursorScreenPoint()
 *  4. 計算新窗口位置 = 游標位置 - 偏移量，並限制在屏幕邊界內
 *  5. 渲染進程在 mouseup 時發送 BALL_STOP_DRAG，停止輪詢
 *  6. 停止後，根據配置決定是否執行邊緣吸附動畫
 *
 * 為什麼不用 -webkit-app-region: drag？
 *  因為它會吞噬 click/contextmenu 等鼠標事件，
 *  導致右鍵菜單和左鍵點擊無法觸發。
 */

import { screen } from 'electron'
import { logger } from './utils/logger'
import type { WindowManager } from './window-manager'

export class FloatingBallManager {
  /** 拖動定時器（null 表示當前未在拖動） */
  private dragInterval: ReturnType<typeof setInterval> | null = null

  /** 拖動時：游標相對於浮球窗口左上角的偏移量 */
  private dragOffset = { x: 0, y: 0 }

  /** 浮球大小（從配置讀取，默認 60） */
  private ballSize = 60

  constructor(
    private readonly windowManager: WindowManager,
    /** 是否啟用邊緣吸附（從配置讀取） */
    private snapToEdge: boolean = true
  ) {}

  /**
   * 開始拖動
   * 記錄初始偏移量，啟動位置更新定時器
   */
  startDrag(): void {
    // 如果已在拖動中，先停止（防止重複啟動）
    if (this.dragInterval) this.stopDrag()

    const ballWindow = this.windowManager.getFloatingBallWindow()
    if (!ballWindow) return

    // 獲取浮球當前位置和游標當前位置，計算偏移量
    const [winX, winY] = ballWindow.getPosition()
    const cursor = screen.getCursorScreenPoint()
    this.dragOffset = {
      x: cursor.x - winX,
      y: cursor.y - winY
    }

    // 以 ~60fps（16ms）的間隔更新浮球位置
    this.dragInterval = setInterval(() => {
      this.updateBallPosition()
    }, 16)

    logger.debug(`開始拖動，偏移: (${this.dragOffset.x}, ${this.dragOffset.y})`, 'FloatingBall')
  }

  /**
   * 停止拖動
   * 清除定時器，根據配置執行邊緣吸附
   */
  stopDrag(): void {
    if (this.dragInterval) {
      clearInterval(this.dragInterval)
      this.dragInterval = null
    }

    // 停止後執行邊緣吸附
    if (this.snapToEdge) {
      this.animateSnapToEdge()
    }

    logger.debug('停止拖動', 'FloatingBall')
  }

  /**
   * 更新浮球位置（在拖動定時器中調用）
   * 基於游標當前位置減去初始偏移量計算目標位置
   */
  private updateBallPosition(): void {
    const ballWindow = this.windowManager.getFloatingBallWindow()
    if (!ballWindow) {
      this.stopDrag()
      return
    }

    const cursor = screen.getCursorScreenPoint()
    const { width, height } = screen.getPrimaryDisplay().workAreaSize

    // 目標位置 = 游標位置 - 初始偏移量
    let targetX = cursor.x - this.dragOffset.x
    let targetY = cursor.y - this.dragOffset.y

    // 邊界限制：確保浮球完全在屏幕工作區內
    targetX = Math.max(0, Math.min(targetX, width - this.ballSize))
    targetY = Math.max(0, Math.min(targetY, height - this.ballSize))

    ballWindow.setPosition(Math.round(targetX), Math.round(targetY))
  }

  /**
   * 邊緣吸附動畫
   * 計算離哪條邊最近，然後平滑移動到該邊緣
   */
  private animateSnapToEdge(): void {
    const ballWindow = this.windowManager.getFloatingBallWindow()
    if (!ballWindow) return

    const [currentX, currentY] = ballWindow.getPosition()
    const { width, height } = screen.getPrimaryDisplay().workAreaSize

    // 計算到四條邊的距離
    const distLeft = currentX
    const distRight = width - currentX - this.ballSize
    const distTop = currentY
    const distBottom = height - currentY - this.ballSize

    // 找到最小距離對應的邊
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

    // 執行平滑移動動畫（20 步，約 200ms）
    this.smoothMove(currentX, currentY, targetX, targetY, 20, 10)

    logger.debug(
      `邊緣吸附: (${currentX}, ${currentY}) → (${targetX}, ${targetY})`,
      'FloatingBall'
    )
  }

  /**
   * 平滑移動動畫（緩動函數：easeOut）
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
    const ballWindow = this.windowManager.getFloatingBallWindow()
    if (!ballWindow) return

    let step = 0
    const animInterval = setInterval(() => {
      step++
      if (step >= steps) {
        clearInterval(animInterval)
        ballWindow.setPosition(Math.round(toX), Math.round(toY))
        return
      }

      // easeOut 緩動：t = step/steps，position = from + (to-from) * (1-(1-t)^2)
      const t = step / steps
      const ease = 1 - Math.pow(1 - t, 2)
      const x = Math.round(fromX + (toX - fromX) * ease)
      const y = Math.round(fromY + (toY - fromY) * ease)
      ballWindow.setPosition(x, y)
    }, intervalMs)
  }

  /** 更新 snapToEdge 配置（配置熱更新時調用） */
  setSnapToEdge(snap: boolean): void {
    this.snapToEdge = snap
  }

  /** 更新浮球大小（配置熱更新時調用） */
  setBallSize(size: number): void {
    this.ballSize = size
  }
}
