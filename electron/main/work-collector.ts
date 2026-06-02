/**
 * 工作採集 Scheduler(主進程)。
 *
 * 拆三個協作者,Scheduler 只做編排:
 *   CaptureService       截圖 / dHash / 可見視窗
 *   IdleDetector         閒置判定
 *   WorkSyncCoordinator  config pull / sync 觸發 + renderer ack 追蹤
 *
 * HTTP 一律在 renderer 跑(JWT 在 renderer),main 只決策「該不該 sync / pull」並推 IPC。
 */

import {desktopCapturer, NativeImage, powerMonitor, screen} from 'electron'
import {logger} from './utils/logger'
import {IpcChannels} from '../shared/ipc-channels'
import type {ConfigManager} from './config-manager'
import type {WindowManager} from './window-manager'
import type {WorkRecordService} from './db/features/work-collect/service'

/** dHash Hamming 距離 ≤ 此值視為畫面未變(64 bit 容忍 ~15%) */
const HASH_SIMILAR_THRESHOLD = 10
/** idle 判定 grace 秒數,抗 setInterval 漂移 */
const IDLE_GRACE_SECONDS = 5
/** unsynced 累積超過此值,工時內提前 sync */
const SAFETY_NET_UNSYNCED_THRESHOLD = 50

// ─── 截圖 / dHash / 視窗 ──────────────────────────────────────────────

class CaptureService {
    async captureScreenshot(): Promise<NativeImage> {
        const {width, height} = screen.getPrimaryDisplay().workAreaSize
        const sources = await desktopCapturer.getSources({types: ['screen'], thumbnailSize: {width, height}})
        return sources[0].thumbnail
    }

    /** 可見視窗標題,排除自家 app,最多 10 個 */
    async collectVisibleWindowTitles(): Promise<string[]> {
        const sources = await desktopCapturer.getSources({types: ['window'], thumbnailSize: {width: 0, height: 0}})
        return sources.map((s) => s.name).filter((n) => n && !/ichia ?desktop/i.test(n)).slice(0, 10)
    }

    /** dHash:9x8 灰階差分 → 64 bit,回 16 hex */
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

    extractAppHint(title: string): string {
        const parts = title.split(' - ')
        return parts.length > 1 ? parts[parts.length - 1].trim() : title
    }
}

// ─── 閒置偵測 ─────────────────────────────────────────────────────────

class IdleDetector {
    private lastHash: string | null = null
    private lastActiveTitle: string | null = null

    /** 系統 idle 超過間隔,或 dHash 近似且前台視窗未變 → idle */
    detect(currentHash: string, activeTitle: string, intervalSec: number): boolean {
        const idleThreshold = Math.max(1, intervalSec - IDLE_GRACE_SECONDS)
        const idleSec = powerMonitor.getSystemIdleTime()
        const dist = this.lastHash && this.lastActiveTitle === activeTitle
            ? hammingHex(this.lastHash, currentHash)
            : null
        // 每 tick 都會印,放 debug 不落庫(避免淹沒 DB)
        logger.debug(
            `idle 判定 idleSec=${idleSec}/${idleThreshold} dist=${dist ?? 'n/a'}/${HASH_SIMILAR_THRESHOLD}`,
            'WorkCollector',
        )
        if (idleSec >= idleThreshold) return true
        return dist !== null && dist <= HASH_SIMILAR_THRESHOLD
    }

    rememberState(hash: string, activeTitle: string): void {
        this.lastHash = hash
        this.lastActiveTitle = activeTitle
    }
}

// ─── config / sync 推送協調 ───────────────────────────────────────────

type SyncReason = 'startup' | 'work-end' | 'safety-net'

/**
 * main → renderer 的 push 觸發 + ack 追蹤。
 *
 * push 可能在 renderer 尚未訂閱時發出而被吞,所以「推完不算數,renderer ack 才算數」:
 *   - config:markConfigSynced() 後才更新 lastConfigSyncedDay
 *   - sync:  markSyncDone(ok) 成功才清 pendingSyncReason;失敗保留待重試
 * renderer bootstrap 後 invoke ready → onRendererReady() 重放 pending。
 */
class WorkSyncCoordinator {
    private lastConfigSyncedDay: string | null = null
    private pendingConfigDay: string | null = null
    private pendingSyncReason: SyncReason | null = null

    constructor(
        private readonly winMgr: WindowManager,
        private readonly recordService: WorkRecordService | null,
    ) {
    }

    /** 每天首次 tick:今天還沒 ack 過就推 config pull */
    maybeRequestConfigPull(): void {
        const today = getBeijingDate()
        if (this.lastConfigSyncedDay === today || this.pendingConfigDay === today) return
        this.tryPushConfigRequest(today)
    }

    /** scheduler 啟動補推 */
    forceConfigPull(): void {
        this.tryPushConfigRequest(getBeijingDate())
    }

    /** renderer 套用 config 後 ack */
    markConfigSynced(): void {
        this.lastConfigSyncedDay = this.pendingConfigDay ?? getBeijingDate()
        this.pendingConfigDay = null
        logger.info('config 已同步', 'WorkSync')
    }

    /**
     * 推 sync request(未 ack 前以最高優先 reason 暫存)。
     *
     * 順便 pull 一次 config:跟「上報寫在一起」,使用者沒綁模板就 fail 一次了事,
     * 不額外排重試 timer;下次 sync 觸發再順道拉。
     */
    requestSync(reason: SyncReason): void {
        const win = this.winMgr.getMainWindow()
        if (!win || win.isDestroyed()) {
            this.pendingSyncReason = this.escalate(this.pendingSyncReason, reason)
            logger.debug(`sync(${reason}) 暫緩,等 renderer ready`, 'WorkSync')
            return
        }
        win.webContents.send(IpcChannels.PUSH_WORK_COLLECT_SYNC_REQUEST, {reason})
        this.pendingSyncReason = reason
        logger.debug(`已推 sync request reason=${reason}`, 'WorkSync')

        // 順道 pull config:tryPushConfigRequest 自帶當日去重,同日多次 sync 只會推一次 IPC
        this.tryPushConfigRequest(getBeijingDate())
    }

    /** renderer sync 完成 ack:成功清 pending,失敗保留待下次觸發 / ready 重放 */
    markSyncDone(ok: boolean, detail?: string): void {
        if (ok) {
            this.pendingSyncReason = null
            logger.debug('sync ack ok', 'WorkSync')
        } else {
            logger.warn(`sync 未完成,保留 pending 待重試 detail=${detail ?? ''}`, 'WorkSync')
        }
    }

    /** renderer ready → 重放 pending config / sync */
    onRendererReady(): void {
        const win = this.winMgr.getMainWindow()
        if (!win || win.isDestroyed()) return
        if (this.pendingConfigDay) {
            win.webContents.send(IpcChannels.PUSH_WORK_COLLECT_CONFIG_REQUEST)
        }
        if (this.pendingSyncReason) {
            win.webContents.send(IpcChannels.PUSH_WORK_COLLECT_SYNC_REQUEST, {reason: this.pendingSyncReason})
        }
    }

    /** 工時內 unsynced 過多則提前 sync */
    maybeSafetyNetSync(): void {
        if (!this.recordService) return
        if (this.recordService.countUnsynced() >= SAFETY_NET_UNSYNCED_THRESHOLD) {
            this.requestSync('safety-net')
        }
    }

    private tryPushConfigRequest(targetDay: string): void {
        const win = this.winMgr.getMainWindow()
        this.pendingConfigDay = targetDay
        if (!win || win.isDestroyed()) {
            // 臨時改 info,排錯期觀察 IPC 推送時機;穩定後可降回 debug
            logger.info('config pull 暫緩,等 renderer ready', 'WorkSync')
            return
        }
        win.webContents.send(IpcChannels.PUSH_WORK_COLLECT_CONFIG_REQUEST)
        logger.info(`已推 config pull(target=${targetDay})`, 'WorkSync')
    }

    /** safety-net > work-end > startup;pending 只升不降 */
    private escalate(curr: SyncReason | null, next: SyncReason): SyncReason {
        if (!curr) return next
        const rank: Record<SyncReason, number> = {startup: 0, 'work-end': 1, 'safety-net': 2}
        return rank[next] > rank[curr] ? next : curr
    }
}

// ─── Scheduler ────────────────────────────────────────────────────────

export class WorkCollectorScheduler {
    private timer: NodeJS.Timeout | null = null
    /** jitter 啟動延遲計時器,跟 interval timer 分開追蹤,避免 jitter 期間重入排多個 timeout */
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
            return  // 同上,不重試;管理員指派後使用者重啟 desktop 即可
        }
        if (this.timer || this.startupTimer) return // jitter 期間 timer 仍 null,要靠 startupTimer 擋重入

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
            clearTimeout(this.startupTimer);
            this.startupTimer = null
        }
        if (this.timer) {
            clearInterval(this.timer);
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
        this.isScreenLocked = true;
        logger.debug('螢幕已鎖,採集暫停', 'WorkCollector')
    }

    private readonly onUnlock = () => {
        this.isScreenLocked = false;
        logger.debug('螢幕已解鎖', 'WorkCollector')
    }

    private async tick(): Promise<void> {
        try {
            this.sync.maybeRequestConfigPull()
            const insideNow = this.isInWorkHours()
            if (this.lastInsideWorkHours && !insideNow) this.sync.requestSync('work-end') // 跨工時結束邊界
            this.lastInsideWorkHours = insideNow

            if (this.isScreenLocked || !insideNow) return
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

            // 非 idle → 推 renderer 走 AI 分析
            win.webContents.send(IpcChannels.PUSH_WORK_COLLECT_TICK, {
                jpeg: new Uint8Array(thumb.toJPEG(70)),
                activeWindow: activeTitle,
                appName: activeApp,
                allWindows: allWindowTitles,
                capturedAt,
                screenshotHash: hash,
            })
            this.idle.rememberState(hash, activeTitle)
        } catch (err) {
            logger.warn('採集 tick 失敗', 'WorkCollector', err)
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
            this.winMgr.getMainWindow()?.webContents.send(IpcChannels.PUSH_WORK_RECORD_NEW)
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

// ─── 北京時間工具(UTC+8 無 DST,直接 +8h 偏移) ──────────────────────

function getBeijingHour(): number {
    return (new Date().getUTCHours() + 8) % 24
}

function getBeijingDate(): string {
    const b = new Date(Date.now() + 8 * 3600_000)
    const p = (n: number) => String(n).padStart(2, '0')
    return `${b.getUTCFullYear()}-${p(b.getUTCMonth() + 1)}-${p(b.getUTCDate())}`
}

/** 兩個 16-hex dHash 的 Hamming 距離 */
function hammingHex(a: string, b: string): number {
    if (a.length !== b.length) return 64
    let d = 0
    for (let i = 0; i < a.length; i += 2) {
        let x = parseInt(a.substr(i, 2), 16) ^ parseInt(b.substr(i, 2), 16)
        while (x) {
            d += x & 1;
            x >>>= 1
        }
    }
    return d
}
