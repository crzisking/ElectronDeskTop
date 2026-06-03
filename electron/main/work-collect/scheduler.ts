/**
 * 工作採集 Scheduler — 編排者(Orchestrator)。
 *
 * 只做編排,不寫業務 / 技術細節:
 *   CaptureService          截圖 / dHash / 視窗清單(Infrastructure)
 *   IdleDetector            閒置判定(Domain)
 *   WorkSyncCoordinator     config / sync 的 IPC push + ack(Orchestrator)
 *   prompt-builder          本地組 prompt(Domain)
 *
 * HTTP 一律在 renderer 跑(JWT 在 renderer),main 只決策「該不該 sync / pull」並推 IPC。
 */

import {powerMonitor} from 'electron'
import {logger} from '../utils/logger'
import {IpcChannels} from '../../shared/ipc-channels'
import type {ConfigManager} from '../config-manager'
import type {WindowManager} from '../window-manager'
import type {WorkRecordService} from '../db/features/work-collect/service'
import type {WorkTemplateCacheService} from '../db/features/work-collect/template-cache.service'
import {CaptureService} from './capture'
import {IdleDetector} from './idle-detector'
import {WorkSyncCoordinator} from './sync-coordinator'
import {buildSystemPrompt, collectAllowedCodes} from './prompt-builder'
import {getBeijingHour} from './time-utils'

export class WorkCollectorScheduler {
    private timer: NodeJS.Timeout | null = null
    /** jitter 啟動延遲計時器,跟 interval timer 分開追蹤,避免 jitter 期間重入排多個 timeout */
    private startupTimer: NodeJS.Timeout | null = null
    private isScreenLocked = false
    private lastInsideWorkHours = false
    /**
     * tick 重入鎖:setInterval 不會等 async callback 完成才排下一輪,
     * 若一次 capture/dHash/IPC 用了超過 interval,沒鎖會多開一條;
     * 採集間隔通常 5 分鐘,但 interval 可被管理員改小,加鎖才穩。
     */
    private ticking = false

    private readonly capture = new CaptureService()
    private readonly idle = new IdleDetector()
    private readonly sync: WorkSyncCoordinator

    constructor(
        private readonly cfg: ConfigManager,
        private readonly winMgr: WindowManager,
        private readonly recordService: WorkRecordService | null,
        /** 模板 cache:tick 內讀,組 prompt;null = DB 沒就緒,退化為 fallback(server 兜底) */
        private readonly templateCache: WorkTemplateCacheService | null = null,
    ) {
        this.sync = new WorkSyncCoordinator(winMgr, recordService)
        powerMonitor.on('lock-screen', this.onLock)
        powerMonitor.on('unlock-screen', this.onUnlock)
    }

    start(): void {
        // 啟動先 pull 一次 config(管理員 PATCH 後重啟 desktop 走這條拿新模板)
        this.sync.forceConfigPull()

        const c = this.cfg.getConfig().workCollect
        if (!c?.enabled) {
            logger.info('採集未啟用,scheduler 不啟動', 'WorkCollector')
            return  // gate fail 不重試;下次有 sync trigger 會順道再 pull
        }
        if (!c.categoryTemplateId) {
            logger.info('未綁業務模板,scheduler 不啟動(請管理員指派模板)', 'WorkCollector')
            return
        }
        if (this.timer || this.startupTimer) return  // jitter 期間 timer 仍 null,靠 startupTimer 擋重入

        const intervalMs = Math.max(1, c.intervalMinutes ?? 5) * 60_000
        const jitterMs = Math.floor(Math.random() * intervalMs * 0.5)
        this.startupTimer = setTimeout(() => {
            this.startupTimer = null
            // sync trigger 內部會順道 pull config,不用單獨 forceConfigPull
            this.sync.requestSync('startup')
            void this.tick()
            this.timer = setInterval(() => void this.tick(), intervalMs)
        }, jitterMs)
        logger.info(`採集已啟動,間隔 ${intervalMs / 60_000} 分,jitter ${Math.round(jitterMs / 1000)}s`, 'WorkCollector')
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
        logger.info('採集已停止', 'WorkCollector')
    }

    /** IPC: renderer 套用 config 後 ack */
    markConfigSynced(): void {
        this.sync.markConfigSynced()
    }

    /** IPC: renderer sync 完成 ack */
    markSyncDone(ok: boolean, detail?: string): void {
        this.sync.markSyncDone(ok, detail)
    }

    /** IPC: renderer bootstrap 完成 → 重放 pending */
    onRendererReady(): void {
        this.sync.onRendererReady()
    }

    dispose(): void {
        this.stop()
        powerMonitor.removeListener('lock-screen', this.onLock)
        powerMonitor.removeListener('unlock-screen', this.onUnlock)
    }

    // 存引用以便 dispose 移除(powerMonitor 是進程級單例,監聽器不清會殘留)
    private readonly onLock = () => {
        this.isScreenLocked = true
        logger.debug('螢幕已鎖,採集暫停', 'WorkCollector')
    }

    private readonly onUnlock = () => {
        this.isScreenLocked = false
        logger.debug('螢幕已解鎖', 'WorkCollector')
    }

    private async tick(): Promise<void> {
        // ── 輕量檢查放在重入鎖之外 ──
        // 這些只是 push IPC 給 coordinator,本身 O(微秒),不卡 tick;
        // 放鎖內的話,上一輪 tick 卡住 → 本輪整個跳過 → 工時邊界推送被吃掉,直到上一輪結束才補。
        this.sync.maybeRequestConfigPull()
        const insideNow = this.isInWorkHours()
        if (this.lastInsideWorkHours && !insideNow) this.sync.requestSync('work-end')  // 跨工時結束邊界
        this.lastInsideWorkHours = insideNow

        if (this.isScreenLocked || !insideNow) return

        // ── 重入保護(只保護 capture / IPC 那段重活) ──
        if (this.ticking) {
            logger.debug('前一個 tick 還在跑,跳過本輪重活', 'WorkCollector')
            return
        }
        this.ticking = true
        try {
            this.sync.maybeSafetyNetSync()

            const win = this.winMgr.getMainWindow()
            if (!win || win.isDestroyed()) return

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

            // 非 idle → 本地組 prompt → 推 renderer 走 AI 分析
            // 模板 cache 沒拿到時 prompt='' allowedCodes=[],server 會 fallback 查 DB 組
            const cached = this.templateCache?.read() ?? null
            const prompt = cached ? buildSystemPrompt(cached) : ''
            const allowedCodes = cached ? collectAllowedCodes(cached) : []

            win.webContents.send(IpcChannels.PUSH_WORK_COLLECT_TICK, {
                jpeg: new Uint8Array(thumb.toJPEG(70)),
                activeWindow: activeTitle,
                appName: activeApp,
                allWindows: allWindowTitles,
                capturedAt,
                screenshotHash: hash,
                prompt,
                allowedCodes,
            })
            this.idle.rememberState(hash, activeTitle)
        } catch (err) {
            logger.warn('採集 tick 失敗', 'WorkCollector', err)
        } finally {
            this.ticking = false
        }
    }

    private writeIdleRecord(capturedAt: number, activeApp: string | null, activeTitle: string | null, hash: string): void {
        if (!this.recordService) return
        // 模板化後:idle 的 category 用 'OTHER' 佔位,實際靠 activityState='idle' 區分
        const result = this.recordService.insert({
            capturedAt,
            activeApp: activeApp || null,
            activeWindowTitle: activeTitle || null,
            category: 'OTHER',
            description: '畫面與輸入皆無變化,判定為閒置',
            reason: '系統 idle 超過一次採集間隔,或 dHash 與上次近似且前台視窗未變',
            confidence: 1,
            screenshotHash: hash,
            activityState: 'idle',
        })
        if (result.ok) {
            this.winMgr.broadcastToWorkRecordViewers(IpcChannels.PUSH_WORK_RECORD_NEW)
        } else {
            logger.warn(`idle 紀錄寫入失敗 reason=${result.reason}`, 'WorkCollector')
        }
    }

    /** 北京時間工時 [start, end);UTC+8 無 DST */
    private isInWorkHours(): boolean {
        const c = this.cfg.getConfig().workCollect
        const hour = getBeijingHour()
        return hour >= (c?.workStartHour ?? 8) && hour < (c?.workEndHour ?? 17)
    }
}
