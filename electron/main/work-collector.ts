/**
 * 工作自動採集 Scheduler(主進程側,只做「採集 + 推送」)。
 *
 * 職責切割原則:
 *   - 主進程能做、只能在主進程做的:setInterval 計時、desktopCapturer、powerMonitor、DB 寫入
 *   - renderer 能做的:走 createHttpClient 打後端 AI 接口(複用 auth 攔截器、unified error handling)
 *
 * 每隔 N 分鐘:
 *   1. 檢查總開關 + 工時區間 + 螢幕鎖狀態 → 任一不符就 skip
 *   2. 擷取主螢幕截圖 + 所有可見視窗清單
 *   3. 透過 PUSH_WORK_COLLECT_TICK 把 jpeg(Uint8Array)+ 元數據推給渲染端
 *   4. 渲染端拿到後打後端 AI、再經 WORK_COLLECT_RESULT 回送結果給 handler,handler 才寫 DB
 *
 * 為什麼 HTTP 不在主進程做:
 *   - 主進程沒有 axios + auth 攔截器,自寫一份等於分叉重複實作
 *   - token 在 renderer 的 Pinia 內,在 main 取要額外 IPC 同步
 *   - renderer 失敗有統一錯誤處理(toast、跳登入頁等),main 沒這套
 *
 * 截圖端到端不落地:Buffer 只活在 tick() 作用域 + IPC payload,送完就 GC。
 */

import {desktopCapturer, powerMonitor, screen} from 'electron'
import {logger} from './utils/logger'
import {IpcChannels} from '../shared/ipc-channels'
import type {ConfigManager} from './config-manager'
import type {WindowManager} from './window-manager'

export class WorkCollectorScheduler {
  private timer: NodeJS.Timeout | null = null

  /** 螢幕鎖狀態,由 powerMonitor 事件維護;app 啟動時假設未鎖 */
  private isScreenLocked = false

  constructor(
    private readonly cfg: ConfigManager,
    private readonly winMgr: WindowManager
  ) {
    // 訂閱螢幕鎖事件:鎖屏期間整個 tick 跳過,不擷取截圖也不推 IPC
    powerMonitor.on('lock-screen', () => {
      this.isScreenLocked = true
      logger.info('螢幕已鎖,工作採集暫停', 'WorkCollector')
    })
    powerMonitor.on('unlock-screen', () => {
      this.isScreenLocked = false
      logger.info('螢幕已解鎖,工作採集恢復', 'WorkCollector')
    })
  }

  /** 啟動採集。讀 config 看 enabled 跟 intervalMinutes */
  start(): void {
    const c = this.cfg.getConfig().workCollect
    if (!c?.enabled) {
      logger.info('工作採集未啟用,scheduler 不啟動', 'WorkCollector')
      return
    }
    if (this.timer) return // 已啟動,不重複

    const intervalMs = Math.max(1, c.intervalMinutes ?? 5) * 60_000
    this.timer = setInterval(() => void this.tick(), intervalMs)
    logger.info(`工作採集已啟動,間隔 ${intervalMs / 60_000} 分鐘`, 'WorkCollector')
  }

  /** 停止採集(關閉開關時 / app 退出時呼叫) */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
      logger.info('工作採集已停止', 'WorkCollector')
    }
  }

  /** 單次採集流程,每 N 分鐘執行一次 */
  private async tick(): Promise<void> {
    try {
      // 1. 螢幕鎖 → 跳過
      if (this.isScreenLocked) {
        logger.debug('螢幕鎖中,tick skip', 'WorkCollector')
        return
      }

      // 2. 工時區間 → 跳過
      if (!this.isInWorkHours()) {
        logger.debug('非工時,tick skip', 'WorkCollector')
        return
      }

      // 3. 主視窗沒就緒就 skip(渲染端拿不到推送,白採集)
      const win = this.winMgr.getMainWindow()
      if (!win || win.isDestroyed()) {
        logger.debug('主視窗未就緒,tick skip', 'WorkCollector')
        return
      }

      // 4. 截圖(只擷主螢幕)
      const screenshotJpeg = await this.captureScreenshot()

      // 5. 所有可見視窗標題
      const allWindowTitles = await this.collectVisibleWindowTitles()
      const activeTitle = allWindowTitles[0] ?? ''
      const activeApp = this.extractAppHint(activeTitle)

      // 6. 推給 renderer。Uint8Array 走 structured clone,跨進程零拷貝(實際是內部 transfer)
      win.webContents.send(IpcChannels.PUSH_WORK_COLLECT_TICK, {
        jpeg: new Uint8Array(screenshotJpeg),
        activeWindow: activeTitle,
        appName: activeApp,
        allWindows: allWindowTitles,
        capturedAt: Date.now(),
      })

      logger.debug('採集 tick 已推送至渲染端', 'WorkCollector')
    } catch (err) {
      // tick 失敗只記 log,等下一輪重試,不擴散
      logger.warn('採集 tick 失敗', 'WorkCollector', err)
    }
  }

  /** 判斷現在是否在工時區間內([startHour, endHour),含 start 不含 end) */
  private isInWorkHours(): boolean {
    const c = this.cfg.getConfig().workCollect
    const start = c?.workStartHour ?? 8
    const end = c?.workEndHour ?? 17
    const hour = new Date().getHours()
    return hour >= start && hour < end
  }

  /** 擷取 primary 螢幕 jpeg(quality 70 平衡大小與清晰度) */
  private async captureScreenshot(): Promise<Buffer> {
    const {width, height} = screen.getPrimaryDisplay().workAreaSize
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: {width, height},
    })
    return sources[0].thumbnail.toJPEG(70)
  }

  /**
   * 列出所有可見視窗的標題(thumbnailSize 0 跳過縮圖產生,節省 CPU)。
   * 排除自家 app,最多 10 個。
   */
  private async collectVisibleWindowTitles(): Promise<string[]> {
    const sources = await desktopCapturer.getSources({
      types: ['window'],
      thumbnailSize: {width: 0, height: 0},
    })
    return sources
      .map((s) => s.name)
      .filter((name) => name && !/ichia ?desktop/i.test(name))
      .slice(0, 10)
  }

  /** 從視窗標題猜 app 名(粗略,給後端當輔助訊號;主要還是靠截圖) */
  private extractAppHint(title: string): string {
    const parts = title.split(' - ')
    return parts.length > 1 ? parts[parts.length - 1].trim() : title
  }

  /** dispose:跟其他 manager 一致,gracefulShutdown 內呼叫 */
  dispose(): void {
    this.stop()
  }
}
