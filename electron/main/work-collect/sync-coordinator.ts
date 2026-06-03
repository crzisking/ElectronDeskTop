/**
 * config / sync 推送協調器 — main → renderer 的 IPC push + ack 追蹤。
 *
 * push 可能在 renderer 尚未訂閱時發出而被吞,所以「推完不算數,renderer ack 才算數」:
 *   - config:markConfigSynced() 後才更新 lastConfigSyncedDay
 *   - sync:  markSyncDone(ok) 成功才清 pendingSyncReason;失敗保留待重試
 * renderer bootstrap 後 invoke ready → onRendererReady() 重放 pending。
 *
 * 設計取捨:config pull 跟 sync trigger 寫在一起 —— requestSync 自動順道 pull config,
 * 不額外排重試 timer。沒拉到就等下次 sync 觸發,避免無限重試空轉。
 */

import {IpcChannels} from '../../shared/ipc-channels'
import {logger} from '../utils/logger'
import type {WindowManager} from '../window-manager'
import type {WorkRecordService} from '../db/features/work-collect/service'
import {getBeijingDate} from './time-utils'

/** unsynced 累積超過此值,工時內提前 sync */
const SAFETY_NET_UNSYNCED_THRESHOLD = 50

export type SyncReason = 'startup' | 'work-end' | 'safety-net'

export class WorkSyncCoordinator {
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
     * 順便 pull 一次 config:跟「上報寫在一起」,沒拉到就 fail 一次,下次再試。
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
