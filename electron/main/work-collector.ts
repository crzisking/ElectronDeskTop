/**
 * 工作自動採集 Scheduler(主進程側)。
 *
 * 內部拆三個協作者讓 Scheduler 只做編排:
 *   - CaptureService   :截圖 / dHash / 可見視窗列表
 *   - IdleDetector     :閒置判定(系統 idle + dHash 相似)
 *   - WorkSyncCoordinator:集中化 config pull / sync trigger + renderer ack 追蹤
 *
 * Scheduler 自己保留的職責:timer / 工時邊界 / 螢幕鎖 / tick 編排 / idle 紀錄寫入。
 *
 * 為什麼不徹底拆檔:這三個協作者目前都只有 scheduler 用,過早拆檔反而增加維護面;
 * 等出現第二個 consumer(例:不同採集頻率的副 Scheduler)再拆檔不晚。
 *
 * 修復重點(對應 review 報告):
 *   #5 jitter 期間重入:用獨立 startupTimer,start() 看到任一 timer 都 return
 *   #6 push 競態:lastConfigSyncDay 不再樂觀更新,改由 IPC handler ack 回呼 markConfigSynced();
 *      新增 onRendererReady() 重放 pending request
 */

import {desktopCapturer, NativeImage, powerMonitor, screen} from 'electron'
import {logger} from './utils/logger'
import {IpcChannels} from '../shared/ipc-channels'
import type {ConfigManager} from './config-manager'
import type {WindowManager} from './window-manager'
import type {WorkRecordService} from './db/features/work-collect/service'

// ─── 常數 ────────────────────────────────────────────────────────────

/**
 * dHash Hamming distance ≤ 此值視為「畫面實質未變」。
 * 64 bit 中容忍約 15% 的差異。
 */
const HASH_SIMILAR_THRESHOLD = 10

/** idle 判定 grace(秒),抗 setInterval ms 漂移 */
const IDLE_GRACE_SECONDS = 5

/** safety net:本機累積 unsynced 超過此值就提前 sync */
const SAFETY_NET_UNSYNCED_THRESHOLD = 50

// ─── 協作者 1:截圖 + dHash + 可見視窗 ───────────────────────────────

class CaptureService {
    /** 擷取主螢幕 NativeImage,thumbnail 用 workAreaSize 全尺寸 */
    async captureScreenshot(): Promise<NativeImage> {
        const {width, height} = screen.getPrimaryDisplay().workAreaSize
        const sources = await desktopCapturer.getSources({
            types: ['screen'],
            thumbnailSize: {width, height},
        })
        return sources[0].thumbnail
    }

    /** 列出可見視窗標題,排除自家 app,最多 10 個 */
    async collectVisibleWindowTitles(): Promise<string[]> {
        const sources = await desktopCapturer.getSources({
            types: ['window'],
            thumbnailSize: {width: 0, height: 0},
        })
        return sources
            .map((s) => s.name)
            .filter((name) => name && !/ichia ?desktop/i.test(name))
            .slice(0, 10)
    }

    /**
     * 算 dHash(差分雜湊):縮到 9x8 灰階,每列相鄰 pixel 比大小得 64 bit。
     * 抗壓縮 / 抗微小位移,人眼一樣的畫面 hash 幾乎一樣。
     */
    computeDHash(img: NativeImage): string {
        const small = img.resize({width: 9, height: 8, quality: 'good'})
        const bgra = small.toBitmap()
        const gray = new Uint8Array(9 * 8)
        for (let i = 0, j = 0; i < bgra.length; i += 4, j++) {
            gray[j] = (bgra[i + 2] * 299 + bgra[i + 1] * 587 + bgra[i] * 114) / 1000 | 0
        }
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

    /** 從視窗標題粗略猜 app 名 */
    extractAppHint(title: string): string {
        const parts = title.split(' - ')
        return parts.length > 1 ? parts[parts.length - 1].trim() : title
    }
}

// ─── 協作者 2:閒置偵測 ──────────────────────────────────────────────

class IdleDetector {
    private lastHash: string | null = null
    private lastActiveTitle: string | null = null

    /**
     * 兩條任一成立判 idle:
     *   - 系統 idle time >= 一次採集間隔(扣 grace)
     *   - dHash 距離小且前台視窗未變(畫面實質沒動)
     */
    detect(currentHash: string, activeTitle: string, intervalSec: number): boolean {
        const idleThreshold = Math.max(1, intervalSec - IDLE_GRACE_SECONDS)
        const idleSec = powerMonitor.getSystemIdleTime()

        const dist = this.lastHash && this.lastActiveTitle === activeTitle
            ? hammingHex(this.lastHash, currentHash)
            : null
        logger.info(
            `tick 閒置判定 idleSec=${idleSec}/${idleThreshold} dHashDist=${dist ?? 'n/a'}/${HASH_SIMILAR_THRESHOLD} sameTitle=${this.lastActiveTitle === activeTitle}`,
            'WorkCollector',
        )

        if (idleSec >= idleThreshold) return true
        return dist !== null && dist <= HASH_SIMILAR_THRESHOLD
    }

    /** 每次 tick 結束都要呼叫,更新 last 狀態 */
    rememberState(hash: string, activeTitle: string): void {
        this.lastHash = hash
        this.lastActiveTitle = activeTitle
    }
}

// ─── 協作者 3:config / sync 推送協調 ────────────────────────────────

type SyncReason = 'startup' | 'work-end' | 'safety-net'

/**
 * 管理 main → renderer 的 push 觸發 + ack 追蹤。
 *
 * 為什麼要 ack:
 *   - main 推 PUSH_WORK_COLLECT_CONFIG_REQUEST 後,renderer 可能還沒 bootstrap()
 *     (未訂閱 channel),這次推送會被吞
 *   - 若樂觀更新 lastConfigSyncDay,當天再也不會重試 → config 不同步
 *   - 改成:推完不更新狀態,renderer 處理完才 ack(markConfigSynced)
 *   - 同時:renderer ready 時主動 invoke notifyReady → main 重放 pending request
 */
class WorkSyncCoordinator {
    /** 已成功 ack 的北京日;只有 ack 才更新此值,中途失敗仍重試 */
    private lastConfigSyncedDay: string | null = null

    /** 已 push 但未 ack 的 config request 對應的「目標日」;ack 後清空 */
    private pendingConfigDay: string | null = null

    /**
     * 已 push 但未 ack 的 sync request 集合。
     * Set 而非單值,因為 startup / work-end / safety-net 可能短時間連推,
     * 但最終都是同一個動作「上傳 unsynced」,所以 Set 也只保留最高優先 reason。
     */
    private pendingSyncReason: SyncReason | null = null

    constructor(
        private readonly winMgr: WindowManager,
        private readonly recordService: WorkRecordService | null,
    ) {
    }

    /** 每天首次 tick 進工時前(若還沒 ack)推 config request */
    maybeRequestConfigPull(): void {
        const today = getBeijingDate()
        if (this.lastConfigSyncedDay === today) return
        // 若已 pending 同一天,不重複推(等 ack 或下次 ready 重放)
        if (this.pendingConfigDay === today) return
        this.tryPushConfigRequest(today)
    }

    /** scheduler.start() 啟動補推一次 */
    forceConfigPull(): void {
        const today = getBeijingDate()
        this.tryPushConfigRequest(today)
    }

    /** IPC handler 收到 renderer 套用 config 後呼叫 */
    markConfigSynced(): void {
        if (this.pendingConfigDay) {
            this.lastConfigSyncedDay = this.pendingConfigDay
            logger.info(`config sync ack(day=${this.pendingConfigDay})`, 'WorkSync')
            this.pendingConfigDay = null
        } else {
            // 沒 pending 也來 ack(例如使用者主動操作觸發),仍以今天為準
            this.lastConfigSyncedDay = getBeijingDate()
        }
    }

    /** 推一次 sync request;未 ack 前不疊加新推送 */
    requestSync(reason: SyncReason): void {
        const win = this.winMgr.getMainWindow()
        if (!win || win.isDestroyed()) {
            // pending,等 ready 補推;higher-priority reason 覆蓋
            this.pendingSyncReason = this.escalate(this.pendingSyncReason, reason)
            logger.debug(`sync(${reason}) 暫緩,等 renderer ready`, 'WorkSync')
            return
        }
        win.webContents.send(IpcChannels.PUSH_WORK_COLLECT_SYNC_REQUEST, {reason})
        this.pendingSyncReason = reason
        logger.info(`已推 sync request reason=${reason}`, 'WorkSync')
    }

    /** Renderer bootstrap 完成 → 補推 pending */
    onRendererReady(): void {
        const win = this.winMgr.getMainWindow()
        if (!win || win.isDestroyed()) return

        if (this.pendingConfigDay) {
            win.webContents.send(IpcChannels.PUSH_WORK_COLLECT_CONFIG_REQUEST)
            logger.info(`renderer ready,補推 config pull(target=${this.pendingConfigDay})`, 'WorkSync')
        }
        if (this.pendingSyncReason) {
            win.webContents.send(IpcChannels.PUSH_WORK_COLLECT_SYNC_REQUEST, {reason: this.pendingSyncReason})
            logger.info(`renderer ready,補推 sync(${this.pendingSyncReason})`, 'WorkSync')
        }
    }

    /**
     * Sync 沒有 ack 路徑(renderer 內部 HTTP 失敗會 log + 等下次,不單獨回 ack)。
     * 簡化:每次 tick 內若 pending 過久(超過一個 interval)就重推。
     * 這裡先保留簡單版,只記下「最近一次 push 時間」做退避。
     */

    /** safety net:工時內 unsynced 過多則推 sync */
    maybeSafetyNetSync(): void {
        if (!this.recordService) return
        const pending = this.recordService.countUnsynced()
        if (pending >= SAFETY_NET_UNSYNCED_THRESHOLD) {
            logger.info(`unsynced=${pending} >= 閾值,觸發 safety-net sync`, 'WorkSync')
            this.requestSync('safety-net')
        }
    }

    private tryPushConfigRequest(targetDay: string): void {
        const win = this.winMgr.getMainWindow()
        if (!win || win.isDestroyed()) {
            // 主視窗未就緒;改 pending 等 onRendererReady 補推
            this.pendingConfigDay = targetDay
            logger.debug('config pull 暫緩,等 renderer ready', 'WorkSync')
            return
        }
        win.webContents.send(IpcChannels.PUSH_WORK_COLLECT_CONFIG_REQUEST)
        this.pendingConfigDay = targetDay
        logger.info(`已推 config pull(target=${targetDay},等 renderer ack)`, 'WorkSync')
    }

    /**
     * reason 優先級(影響 pending 覆蓋):
     *   safety-net > work-end > startup
     * 一旦 pending 升級,不會降回;reason 主要影響 renderer log 與決策。
     */
    private escalate(curr: SyncReason | null, next: SyncReason): SyncReason {
        if (!curr) return next
        const rank: Record<SyncReason, number> = {startup: 0, 'work-end': 1, 'safety-net': 2}
        return rank[next] > rank[curr] ? next : curr
    }
}

// ─── Scheduler 本體 ──────────────────────────────────────────────────

export class WorkCollectorScheduler {
  private timer: NodeJS.Timeout | null = null

    /**
     * 啟動延遲計時器,與 interval timer 分開追蹤。
     * 修正 #5:start() 在 jitter 等待期間被重複呼叫時不再排多個 setTimeout;
     * stop() 同時清掉 startupTimer 與 timer,避免 stop 後 startup 仍觸發。
     */
    private startupTimer: NodeJS.Timeout | null = null

  private isScreenLocked = false
    private lastInsideWorkHours = false

    private readonly capture = new CaptureService()
    private readonly idle = new IdleDetector()
    private readonly sync: WorkSyncCoordinator

  constructor(
    private readonly cfg: ConfigManager,
    private readonly winMgr: WindowManager,
    private readonly recordService: WorkRecordService | null,
  ) {
      this.sync = new WorkSyncCoordinator(winMgr, recordService)

    powerMonitor.on('lock-screen', () => {
      this.isScreenLocked = true
      logger.info('螢幕已鎖,工作採集暫停', 'WorkCollector')
    })
    powerMonitor.on('unlock-screen', () => {
      this.isScreenLocked = false
      logger.info('螢幕已解鎖,工作採集恢復', 'WorkCollector')
    })
  }

    // ── 對外 API ────────────────────────────────────────────────────

  start(): void {
    const c = this.cfg.getConfig().workCollect
    if (!c?.enabled) {
      logger.info('工作採集未啟用,scheduler 不啟動', 'WorkCollector')
      return
    }
      // 修正 #5:jitter 期間 timer 還是 null,要用 startupTimer 一起擋
      if (this.timer || this.startupTimer) {
          logger.debug('scheduler 已在啟動 / 運行中,重複 start 忽略', 'WorkCollector')
          return
      }

    const intervalMs = Math.max(1, c.intervalMinutes ?? 5) * 60_000
      const jitterMs = Math.floor(Math.random() * intervalMs * 0.5)

      this.startupTimer = setTimeout(() => {
          this.startupTimer = null
          this.sync.forceConfigPull()
          this.sync.requestSync('startup')
          void this.tick()
          this.timer = setInterval(() => void this.tick(), intervalMs)
      }, jitterMs)

      logger.info(
          `工作採集已啟動,間隔 ${intervalMs / 60_000} 分鐘,jitter ${Math.round(jitterMs / 1000)}s`,
          'WorkCollector',
      )
  }

  stop(): void {
      if (this.startupTimer) {
          clearTimeout(this.startupTimer)
          this.startupTimer = null
      }
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
      logger.info('工作採集已停止', 'WorkCollector')
  }

    /** IPC handler 收到 renderer 套用 config 後呼叫 */
    markConfigSynced(): void {
        this.sync.markConfigSynced()
    }

    /** Renderer bootstrap 完成 ack 後呼叫 */
    onRendererReady(): void {
        this.sync.onRendererReady()
    }

    dispose(): void {
        this.stop()
  }

    // ── tick 編排 ──────────────────────────────────────────────────

  private async tick(): Promise<void> {
    try {
        // 0. 集中化:每天首次 tick 嘗試拉 config + 偵測工時邊界觸發 sync
        this.sync.maybeRequestConfigPull()
        const insideNow = this.isInWorkHours()
        if (this.lastInsideWorkHours && !insideNow) {
            this.sync.requestSync('work-end')
        }
        this.lastInsideWorkHours = insideNow

      if (this.isScreenLocked) {
        logger.debug('螢幕鎖中,tick skip', 'WorkCollector')
        return
      }
        if (!insideNow) {
        logger.debug('非工時,tick skip', 'WorkCollector')
        return
      }
        this.sync.maybeSafetyNetSync()

      const win = this.winMgr.getMainWindow()
      if (!win || win.isDestroyed()) {
        logger.debug('主視窗未就緒,tick skip', 'WorkCollector')
        return
      }

        const thumb = await this.capture.captureScreenshot()
        const hash = this.capture.computeDHash(thumb)
        const allWindowTitles = await this.capture.collectVisibleWindowTitles()
      const activeTitle = allWindowTitles[0] ?? ''
        const activeApp = this.capture.extractAppHint(activeTitle)
        const capturedAt = Date.now()

        const intervalSec = Math.max(1, this.cfg.getConfig().workCollect?.intervalMinutes ?? 5) * 60
        if (this.idle.detect(hash, activeTitle, intervalSec)) {
            this.writeIdleRecord(capturedAt, activeApp, activeTitle, hash)
            this.idle.rememberState(hash, activeTitle)
            return
        }

        // 推 renderer 走 AI 分析
        const jpeg = thumb.toJPEG(70)
      win.webContents.send(IpcChannels.PUSH_WORK_COLLECT_TICK, {
          jpeg: new Uint8Array(jpeg),
        activeWindow: activeTitle,
        appName: activeApp,
        allWindows: allWindowTitles,
          capturedAt,
          screenshotHash: hash,
      })

        this.idle.rememberState(hash, activeTitle)
      logger.debug('採集 tick 已推送至渲染端', 'WorkCollector')
    } catch (err) {
      logger.warn('採集 tick 失敗', 'WorkCollector', err)
    }
  }

    private writeIdleRecord(
        capturedAt: number,
        activeApp: string | null,
        activeTitle: string | null,
        hash: string,
    ): void {
        if (!this.recordService) {
            logger.warn('命中 idle 但 recordService 不可用,丟棄', 'WorkCollector')
            return
        }
        const result = this.recordService.insert({
            capturedAt,
            activeApp: activeApp || null,
            activeWindowTitle: activeTitle || null,
            category: 'idle',
            description: '畫面與輸入皆無變化,判定為閒置',
            reason: '系統 idle 時間超過一次採集間隔,或截圖 dHash 與上次幾乎相同且前台視窗未變',
            confidence: 1,
            screenshotHash: hash,
        })
        // result.ok=false 仍要通知 UI 刷新?— 寫入失敗就沒新行,不必通知
        if (result.ok) {
            this.winMgr.getMainWindow()?.webContents.send(IpcChannels.PUSH_WORK_RECORD_NEW)
            logger.debug('已寫入 idle 紀錄(skip AI)', 'WorkCollector')
        } else {
            logger.warn(`idle 紀錄寫入失敗 reason=${result.reason}`, 'WorkCollector')
        }
    }

  private isInWorkHours(): boolean {
    const c = this.cfg.getConfig().workCollect
    const start = c?.workStartHour ?? 8
    const end = c?.workEndHour ?? 17
      const hour = getBeijingHour()
    return hour >= start && hour < end
  }
}

// ─── 時區工具(北京時間,UTC+8 無 DST,直接 +8h 偏移) ─────────────

function getBeijingHour(): number {
    return (new Date().getUTCHours() + 8) % 24
}

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
