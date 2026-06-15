/**
 * 備忘到期提醒 — 主進程排程,獨立於備忘窗(窗沒開也會提醒)。
 *
 * 規則:
 *   - 每 30 分鐘檢查一次 pending 備忘(啟動 60 秒後先跑一輪)
 *   - 「24 小時內到期」與「已逾期」各提醒一次(同一備忘同一狀態不重複吵)
 *   - 逾期超過 3 天的舊賬不再提醒(避免長假回來被轟炸)
 *   - 單輪最多 3 條通知,點通知喚起主窗(首頁的待辦區塊就在眼前)
 *
 * 身分:走 authContext(主窗登入時推進來);未登入靜默跳過,登入後下一輪自然生效。
 * 去重狀態存記憶體 — App 重啟後「還在窗口內的」會再提醒一次,可接受(寧可多提醒不漏)。
 */

import {Notification} from 'electron'
import {logger} from '../../utils/logger'
import {projectFlowApi} from '../project-flow/api-client'
import {authContext} from '../auth-context'
import type {WindowManager} from '../../windows/window-manager'

const TAG = 'MemoReminder'

const CHECK_INTERVAL_MS = 30 * 60_000
const STARTUP_DELAY_MS = 60_000
const DUE_SOON_MS = 24 * 3600_000
const STALE_OVERDUE_MS = 3 * 86_400_000
const MAX_NOTIFY_PER_RUN = 3

interface MemoLite {
    memoId: number
    title: string
    status: string
    dueDate?: number | null
}

export class MemoReminderScheduler {
    private timer: NodeJS.Timeout | null = null
    private startupTimer: NodeJS.Timeout | null = null
    /** 已提醒集合,key = `${memoId}:${state}`(state = due-soon | overdue) */
    private readonly notified = new Set<string>()

    constructor(private readonly winMgr: WindowManager) {
    }

    start(): void {
        this.startupTimer = setTimeout(() => {
            this.startupTimer = null
            void this.check()
            this.timer = setInterval(() => void this.check(), CHECK_INTERVAL_MS)
        }, STARTUP_DELAY_MS)
        logger.info('備忘到期提醒排程已啟動', TAG)
    }

    dispose(): void {
        if (this.timer) clearInterval(this.timer)
        if (this.startupTimer) clearTimeout(this.startupTimer)
        this.timer = null
        this.startupTimer = null
    }

    private async check(): Promise<void> {
        const a = authContext.get()
        if (!a.userId) return // 未登入,等下一輪

        try {
            const result = await projectFlowApi.listMemos(
                {baseUrl: a.baseUrl, userId: a.userId, token: a.token},
                {status: 'pending', pageIndex: 1, pageSize: 100},
            ) as { list?: MemoLite[] }

            const now = Date.now()
            let sent = 0
            for (const m of result?.list ?? []) {
                if (sent >= MAX_NOTIFY_PER_RUN) break
                if (!m.dueDate) continue

                const diff = m.dueDate - now
                if (diff <= 0 && -diff <= STALE_OVERDUE_MS) {
                    if (this.notify(m, 'overdue')) sent++
                } else if (diff > 0 && diff <= DUE_SOON_MS) {
                    if (this.notify(m, 'due-soon')) sent++
                }
            }
        } catch (err) {
            // 網路波動等下一輪,不擴散
            logger.warn(`備忘提醒檢查失敗:${(err as Error).message}`, TAG)
        }
    }

    /** 發系統通知;同備忘同狀態只發一次。回 true = 真的發了 */
    private notify(memo: MemoLite, state: 'due-soon' | 'overdue'): boolean {
        const key = `${memo.memoId}:${state}`
        if (this.notified.has(key)) return false
        this.notified.add(key)

        const n = new Notification({
            title: state === 'overdue' ? '備忘已逾期' : '備忘即將到期',
            body: memo.title,
        })
        // 點通知 → 喚起主窗(首頁待辦區塊一眼可見)
        n.on('click', () => {
            const win = this.winMgr.getMainWindow()
            if (win && !win.isDestroyed()) {
                if (win.isMinimized()) win.restore()
                win.show()
                win.focus()
            }
        })
        n.show()
        logger.info(`已發備忘提醒(${state}):${memo.title}`, TAG)
        return true
    }
}
