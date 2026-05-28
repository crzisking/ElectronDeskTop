/**
 * 工作自動採集 Scheduler(主進程側,只做「採集 + 推送 / 命中閒置直接寫 DB」)。
 *
 * 職責切割原則:
 *   - 主進程能做、只能在主進程做的:setInterval 計時、desktopCapturer、powerMonitor、DB 寫入
 *   - renderer 能做的:走 createHttpClient 打後端 AI 接口(複用 auth 攔截器、unified error handling)
 *
 * 每隔 N 分鐘:
 *   1. 檢查總開關 + 工時區間 + 螢幕鎖狀態 → 任一不符就 skip
 *   2. 擷取主螢幕截圖 + 算 dHash + 抓所有可見視窗清單
 *   3. 命中閒置(系統 idle 時間夠長 / 或 dHash 與上次相似且前台視窗未變)→ 直接寫一筆 idle 紀錄,不打 API
 *   4. 否則透過 PUSH_WORK_COLLECT_TICK 把 jpeg+hash+元數據推給渲染端,渲染端打 AI,handler 寫 DB
 *
 * 為什麼 HTTP 不在主進程做:
 *   - 主進程沒有 axios + auth 攔截器,自寫一份等於分叉重複實作
 *   - token 在 renderer 的 Pinia 內,在 main 取要額外 IPC 同步
 *   - renderer 失敗有統一錯誤處理(toast、跳登入頁等),main 沒這套
 *
 * 截圖端到端不落地:Buffer 只活在 tick() 作用域 + IPC payload,送完就 GC。
 */

import {desktopCapturer, NativeImage, powerMonitor, screen} from 'electron'
import {logger} from './utils/logger'
import {IpcChannels} from '../shared/ipc-channels'
import type {ConfigManager} from './config-manager'
import type {WindowManager} from './window-manager'
import type {WorkRecordService} from './db/features/work-collect/service'

/**
 * dHash Hamming distance ≤ 此值視為「畫面實質未變」。
 * 64 bit 中容忍約 15% 的差異 —— 5 太緊,連工作列時鐘走秒 + 游標閃爍位置不同
 * 累積出來的雜訊就會超過;10 在實測上能擋掉時鐘 / 游標 / 微小陰影差異,
 * 同時不會把實際視窗切換誤判成相同。
 */
const HASH_SIMILAR_THRESHOLD = 10

/**
 * idle 時間判定的 grace(秒)。
 * powerMonitor.getSystemIdleTime() 只回整數秒、setInterval 有 ms 級漂移,
 * 若用 `idleSec >= intervalSec` 嚴格比較,實測會卡在 299 vs 300 邊界。
 */
const IDLE_GRACE_SECONDS = 5

export class WorkCollectorScheduler {
  private timer: NodeJS.Timeout | null = null

  /** 螢幕鎖狀態,由 powerMonitor 事件維護;app 啟動時假設未鎖 */
  private isScreenLocked = false

    /** 上次採集的截圖 dHash(16 hex)+ 前台視窗標題,給「畫面未變」判斷用;in-memory,重啟即 reset */
    private lastHash: string | null = null
    private lastActiveTitle: string | null = null

    /** safety net:本機累積 unsynced 超過此值就提前 sync,防 desktop 長期不重啟批次過大 */
    private static readonly SAFETY_NET_UNSYNCED_THRESHOLD = 50
    // ─── 集中化(docs/20)─────────────────────────────────────────────
    /**
     * 上次拉 server config 的北京日期(yyyy-MM-dd);每天首次 tick 進工時前比對,不一致就推 renderer 拉 config。
     * in-memory,重啟即 reset → 重啟時必拉一次。
     */
    private lastConfigSyncDay: string | null = null
    /**
     * 上次 tick 是否在工時內;用於偵測「跨越工時結束邊界」(true→false)→ 觸發 sync。
     * 若 lastInsideWorkHours=true 且本次 isInWorkHours=false → 工時剛結束,推 sync request。
     */
    private lastInsideWorkHours = false

  constructor(
    private readonly cfg: ConfigManager,
    private readonly winMgr: WindowManager,
    private readonly recordService: WorkRecordService | null
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

      // 啟動時延遲一個隨機 jitter(< 50% intervalMs)再開始,避免 500 台 desktop 整點對齊砸 server。
      const jitterMs = Math.floor(Math.random() * intervalMs * 0.5)
      setTimeout(() => {
          // 啟動觸發:拉一次 config + 補傳本地 unsynced(處理「16:55 關機」場景)
          this.requestConfigPull()
          this.requestSync('startup')
          void this.tick()
          this.timer = setInterval(() => void this.tick(), intervalMs)
      }, jitterMs)

      logger.info(
          `工作採集已啟動,間隔 ${intervalMs / 60_000} 分鐘,jitter ${Math.round(jitterMs / 1000)}s`,
          'WorkCollector'
      )
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
        // 0. 集中化:每天首次 tick 拉 config + 偵測跨越工時邊界觸發 sync
        this.maybeRequestConfigPull()
        const insideNow = this.isInWorkHours()
        if (this.lastInsideWorkHours && !insideNow) {
            // 工時剛結束(上一輪在內,這一輪在外)→ 觸發 sync
            this.requestSync('work-end')
        }
        this.lastInsideWorkHours = insideNow

      // 1. 螢幕鎖 → 跳過
      if (this.isScreenLocked) {
        logger.debug('螢幕鎖中,tick skip', 'WorkCollector')
        return
      }

      // 2. 工時區間 → 跳過
        if (!insideNow) {
        logger.debug('非工時,tick skip', 'WorkCollector')
        return
      }

        // 2.5 safety net:工時內若累積 unsynced 過多,提前推 sync(防長期不重啟單批爆量)
        this.maybeSafetyNetSync()

      // 3. 主視窗沒就緒就 skip(渲染端拿不到推送,白採集)
      const win = this.winMgr.getMainWindow()
      if (!win || win.isDestroyed()) {
        logger.debug('主視窗未就緒,tick skip', 'WorkCollector')
        return
      }

        // 4. 截圖(NativeImage,稍後同時 toJPEG 推 renderer + 用 bitmap 算 dHash)
        const thumb = await this.captureScreenshot()
        const hash = this.computeDHash(thumb)

      // 5. 所有可見視窗標題
      const allWindowTitles = await this.collectVisibleWindowTitles()
      const activeTitle = allWindowTitles[0] ?? ''
      const activeApp = this.extractAppHint(activeTitle)
        const capturedAt = Date.now()

        // 6. 命中閒置 → 直接寫 DB,不打 AI
        if (this.detectIdle(hash, activeTitle)) {
            this.writeIdleRecord(capturedAt, activeApp, activeTitle, hash)
            this.lastHash = hash
            this.lastActiveTitle = activeTitle
            return
        }

        // 7. 不是 idle → 推 renderer 走 AI 分析。Uint8Array 走 structured clone
        const jpeg = thumb.toJPEG(70)
      win.webContents.send(IpcChannels.PUSH_WORK_COLLECT_TICK, {
          jpeg: new Uint8Array(jpeg),
        activeWindow: activeTitle,
        appName: activeApp,
        allWindows: allWindowTitles,
          capturedAt,
          screenshotHash: hash,
      })

        this.lastHash = hash
        this.lastActiveTitle = activeTitle
      logger.debug('採集 tick 已推送至渲染端', 'WorkCollector')
    } catch (err) {
      // tick 失敗只記 log,等下一輪重試,不擴散
      logger.warn('採集 tick 失敗', 'WorkCollector', err)
    }
  }

    /**
     * 判斷此次 tick 是否視為閒置:
     *   - 系統 idle time(無滑鼠 / 鍵盤輸入)超過一次採集間隔 → 鐵定閒置
     *   - 或 dHash 與上次幾乎相同 + 前台視窗未變 → 畫面實質沒動
     * 兩條任一成立即判 idle。
     */
    private detectIdle(currentHash: string, activeTitle: string): boolean {
        const c = this.cfg.getConfig().workCollect
        const intervalSec = Math.max(1, c?.intervalMinutes ?? 5) * 60
        const idleThreshold = Math.max(1, intervalSec - IDLE_GRACE_SECONDS)
        const idleSec = powerMonitor.getSystemIdleTime()

        // 同時算出 dHash 距離(可比較才算,否則 null),全部塞進一條 log,
        // 之後再遇到「沒判 idle」的爭議直接看這行就知道哪條沒過
        const dist = this.lastHash && this.lastActiveTitle === activeTitle
            ? hammingHex(this.lastHash, currentHash)
            : null
        logger.info(
            `tick 閒置判定 idleSec=${idleSec}/${idleThreshold} dHashDist=${dist ?? 'n/a'}/${HASH_SIMILAR_THRESHOLD} sameTitle=${this.lastActiveTitle === activeTitle}`,
            'WorkCollector'
        )

        if (idleSec >= idleThreshold) return true
        return dist !== null && dist <= HASH_SIMILAR_THRESHOLD;

    }

    /** 直接寫一筆 idle 紀錄,並推 PUSH_WORK_RECORD_NEW 讓 UI 刷新 */
    private writeIdleRecord(
        capturedAt: number,
        activeApp: string | null,
        activeTitle: string | null,
        hash: string
    ): void {
        if (!this.recordService) {
            logger.warn('命中 idle 但 recordService 不可用,丟棄', 'WorkCollector')
            return
        }
        this.recordService.insert({
            capturedAt,
            activeApp: activeApp || null,
            activeWindowTitle: activeTitle || null,
            category: 'idle',
            description: '畫面與輸入皆無變化,判定為閒置',
            reason: '系統 idle 時間超過一次採集間隔,或截圖 dHash 與上次幾乎相同且前台視窗未變',
            confidence: 1,
            screenshotHash: hash,
        })
        this.winMgr.getMainWindow()?.webContents.send(IpcChannels.PUSH_WORK_RECORD_NEW)
        logger.debug('已寫入 idle 紀錄(skip AI)', 'WorkCollector')
    }

    /**
     * 判斷現在是否在工時區間內([startHour, endHour),含 start 不含 end)。
     * 鎖死北京時間(UTC+8,無 DST),避免 VPN 出差時 OS 時區漂移造成「凌晨採集」混亂。
     */
  private isInWorkHours(): boolean {
    const c = this.cfg.getConfig().workCollect
    const start = c?.workStartHour ?? 8
    const end = c?.workEndHour ?? 17
        const hour = getBeijingHour()
    return hour >= start && hour < end
  }

    // ─── 集中化(docs/20):config / sync 推送輔助 ────────────────────────

    /**
     * 推 PUSH_WORK_COLLECT_CONFIG_REQUEST 要 renderer 拉 /my-config。
     * 標記今天已拉,避免一天重複拉。
     */
    private requestConfigPull(): void {
        const win = this.winMgr.getMainWindow()
        if (!win || win.isDestroyed()) {
            logger.debug('主視窗未就緒,config pull 暫緩', 'WorkCollector')
            return
        }
        const today = getBeijingDate()
        win.webContents.send(IpcChannels.PUSH_WORK_COLLECT_CONFIG_REQUEST)
        this.lastConfigSyncDay = today
        logger.info(`已推 config pull(beijingDay=${today})`, 'WorkCollector')
    }

    /** 每天首次 tick 進工時前若還沒拉過 config,推一次 */
    private maybeRequestConfigPull(): void {
        const today = getBeijingDate()
        if (this.lastConfigSyncDay === today) return
        this.requestConfigPull()
    }

    /** 推 PUSH_WORK_COLLECT_SYNC_REQUEST 要 renderer 上傳 unsynced */
    private requestSync(reason: 'startup' | 'work-end' | 'safety-net'): void {
        const win = this.winMgr.getMainWindow()
        if (!win || win.isDestroyed()) {
            logger.debug(`主視窗未就緒,sync(${reason}) 暫緩`, 'WorkCollector')
            return
        }
        win.webContents.send(IpcChannels.PUSH_WORK_COLLECT_SYNC_REQUEST, {reason})
        logger.info(`已推 sync request reason=${reason}`, 'WorkCollector')
    }

    /** 工時內若 unsynced 累積過多,提前 sync;次數不會過頻(僅每 tick 檢查一次,且閾值較高) */
    private maybeSafetyNetSync(): void {
        if (!this.recordService) return
        const pending = this.recordService.countUnsynced()
        if (pending >= WorkCollectorScheduler.SAFETY_NET_UNSYNCED_THRESHOLD) {
            logger.info(`unsynced=${pending} >= 閾值,觸發 safety-net sync`, 'WorkCollector')
            this.requestSync('safety-net')
        }
    }

    /** 擷取 primary 螢幕 NativeImage(thumbnail 用 workAreaSize 全尺寸) */
    private async captureScreenshot(): Promise<NativeImage> {
    const {width, height} = screen.getPrimaryDisplay().workAreaSize
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: {width, height},
    })
        return sources[0].thumbnail
    }

    /**
     * 算 dHash(差分雜湊):
     *   把畫面縮到 9x8 灰階 → 每列相鄰兩 pixel 比較大小,得 8 bit,共 64 bit
     *   抗壓縮 / 抗微小位移,跟 MD5 不同,人眼一樣的畫面 hash 也會幾乎一樣
     * 回傳 16 hex 字元。
     */
    private computeDHash(img: NativeImage): string {
        const small = img.resize({width: 9, height: 8, quality: 'good'})
        const bgra = small.toBitmap() // BGRA, 9*8*4 = 288 bytes
        // 灰階值(0-255),Rec. 601 加權
        const gray = new Uint8Array(9 * 8)
        for (let i = 0, j = 0; i < bgra.length; i += 4, j++) {
            gray[j] = (bgra[i + 2] * 299 + bgra[i + 1] * 587 + bgra[i] * 114) / 1000 | 0
        }
        // 每列 8 個比較 → 8 bit
        let hex = ''
        for (let y = 0; y < 8; y++) {
            let row = 0
            for (let x = 0; x < 8; x++) {
                if (gray[y * 9 + x] > gray[y * 9 + x + 1]) row |= 1 << (7 - x)
            }
            hex += row.toString(16).padStart(2, '0')
        }
        return hex
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

/**
 * 北京時間小時(0-23);UTC+8 無 DST,直接 +8h 後取 UTC 小時。
 * 不用 date-fns-tz / Intl.DateTimeFormat,避免額外依賴。
 */
function getBeijingHour(): number {
    return (new Date().getUTCHours() + 8) % 24
}

/** 北京日期 yyyy-MM-dd;config 同步以「北京日」為單位判斷今天是否拉過 */
function getBeijingDate(): string {
    const beijing = new Date(Date.now() + 8 * 3600_000)
    const y = beijing.getUTCFullYear()
    const m = String(beijing.getUTCMonth() + 1).padStart(2, '0')
    const d = String(beijing.getUTCDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
}

/** 兩個 16-hex dHash 字串的 Hamming distance(逐 byte popcount) */
function hammingHex(a: string, b: string): number {
    if (a.length !== b.length) return 64
    let d = 0
    for (let i = 0; i < a.length; i += 2) {
        const xa = parseInt(a.substr(i, 2), 16)
        const xb = parseInt(b.substr(i, 2), 16)
        let x = xa ^ xb
        while (x) {
            d += x & 1
            x >>>= 1
        }
    }
    return d
}
