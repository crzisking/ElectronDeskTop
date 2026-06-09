/**
 * WorkCollectSyncService — 主進程版批次同步協調器。
 *
 * 集中化的最後一步(docs/20):原本 renderer 端 90 行的 syncDailyRecords 循環,
 * 包含 listUnsynced(IPC) → HTTP POST → markSynced(IPC) → loop;每批 2 次 IPC,
 * 50 批 ~ 100 次跨進程往返。本服務把整段流程搬到 main:
 *   - listUnsynced / markSynced 直接呼 workRecordService(同進程 DB)
 *   - HTTP POST 走 main process 內建 fetch(electron 28+ / node 18+ 全域可用)
 *   - 整個 sync session 對 renderer 只剩 1 次 IPC(觸發 + 等結果)
 *
 * 設計取捨:
 *  - **不持有 token / userName**:每次 run() 由 renderer 在發起時帶進來。
 *    JWT 政策上不寫盤,只活在 process 記憶體;main 跟 renderer 在這點上同等待遇。
 *  - **不啟動 scheduler**:scheduler 的「何時 sync」邏輯不動,本服務只負責「sync 邏輯本身」。
 *  - **失敗策略**:對齊舊版 renderer 行為 —— 單批 HTTP 失敗整 session 退出、留 unsynced
 *    待下次觸發;markSynced 失敗自帶 3 次重試。
 */

import {logger} from '../utils/logger'
import type {WorkRecordService} from '../db/features/work-collect/service'
import type {WorkRecord} from '../db/features'
import type {WorkSyncRunPayload, WorkSyncRunResult} from '../../shared/types/work-collect.types'

const TAG = 'WorkCollectSync'

/** 單次 sync session 最多輪數:50 × 200 = 10K/次,超過剩餘留下次 trigger,不丟資料 */
const SYNC_MAX_ROUNDS = 50

/** 每批最多筆數 — 對齊舊 renderer 行為(後端單請求上限 200) */
const BATCH_SIZE = 200

/** 削峰散佈窗口(對齊舊 request-scheduler.ts 的 sync-daily profile) */
const SPREAD_MS = 25_000

/** 後端 HTTP 超時 */
const REQUEST_TIMEOUT_MS = 30_000

/** sync-daily 單筆 payload(對齊渲染端 types.ts 的 WorkSyncRecordItem) */
interface SyncRecordItem {
    localId: number
    capturedAt: number
    activeApp: string | null
    activeWindowTitle: string | null
    category: string
    description: string
    confidence: number | null
    screenshotHash: string | null
    reason: string | null
    activityState: string
}

/** 後端 /sync-daily .data 結構 */
interface SyncDailyResponseData {
    inserted: number
    duplicates: number
    syncedAt: number
    successLocalIds: number[]
    duplicateLocalIds: number[]
    failedLocalIds: number[]
}

/** 後端 unified envelope:{ data: T } 或 T 自己;兩種都吞 */
function extractData<T>(json: unknown): T {
    if (json && typeof json === 'object' && 'data' in json && (json as { data: unknown }).data) {
        return (json as { data: T }).data
    }
    return json as T
}

export class WorkCollectSyncService {
    constructor(private readonly recordService: WorkRecordService) {
    }

    /**
     * 跑一次完整 sync session。
     * 失敗只 log,不擴散;呼叫方(IPC handler)拿到 result 通常只記到 log。
     */
    async run(payload: WorkSyncRunPayload): Promise<WorkSyncRunResult> {
        const {userName, token, baseUrl} = payload
        if (!userName || !token || !baseUrl) {
            logger.warn('runSync 缺少 userName/token/baseUrl,跳過', TAG)
            return {ok: false, synced: 0, failed: 0, hitLimit: false, error: 'missing credentials'}
        }

        let totalSynced = 0
        let totalFailed = 0
        let ok = true
        let error: string | undefined
        let hitLimit = false

        // 削峰:對齊舊 client-side jitter,500 機在 25s 內隨機分佈 ≈ 20 req/s。
        // **每個 sync session 只 jitter 一次**(不是每批):本來 per-batch 0-25s × 最多 50 批
        // = 最壞 21 分鐘才同步完。jitter 的本意是「跨機器分散同秒峰值」,單機內 batch 連續打
        // 對 server 負載無差。Math.random 各機獨立,期望分佈仍均勻。
        await sleep(Math.floor(Math.random() * SPREAD_MS))

        let round = 0
        for (; round < SYNC_MAX_ROUNDS; round++) {
            const chunk = this.recordService.listUnsynced(BATCH_SIZE)
            if (chunk.length === 0) break

            const records = chunk.map(toSyncRecord)

            let resp: SyncDailyResponseData
            try {
                resp = await this.postSyncDaily(baseUrl, token, userName, records)
            } catch (err) {
                ok = false
                error = `sync-daily HTTP 失敗: ${errMsg(err)}`
                logger.warn(error, TAG)
                break
            }

            // success(真插入)+ duplicate(server 已有)才標 synced;failed 留下次
            const toMark = [...(resp.successLocalIds ?? []), ...(resp.duplicateLocalIds ?? [])]
            if (toMark.length > 0) {
                const markRes = await this.markSyncedWithRetry(toMark, resp.syncedAt ?? Date.now())
                if (!markRes.ok) {
                    ok = false
                    error = `markSynced 重試耗盡: ${markRes.reason}`
                    logger.warn(error, TAG)
                    // 退出但不視為災難:server 已收下,下次 sync 會被 server UNIQUE 擋,
                    // 走 duplicate 分支再嘗試 mark 一次,自然收斂。
                    break
                }
            }
            totalSynced += toMark.length
            totalFailed += (resp.failedLocalIds ?? []).length
            if (chunk.length < BATCH_SIZE) break // 已撈乾淨
        }

        if (round >= SYNC_MAX_ROUNDS) {
            hitLimit = true
            logger.warn(
                `sync 達單次輪數上限 ${SYNC_MAX_ROUNDS}(約 ${SYNC_MAX_ROUNDS * BATCH_SIZE} 條),剩餘留下次 trigger`,
                TAG,
            )
        }

        if (totalFailed > 0 || hitLimit) ok = false
        logger.info(
            `sync 完成 synced=${totalSynced} failed=${totalFailed} hitLimit=${hitLimit} ok=${ok}`,
            TAG,
        )
        return {ok, synced: totalSynced, failed: totalFailed, hitLimit, error}
    }

    /** HTTP POST /api/WorkCollect/sync-daily。失敗拋例外,由 caller 統一捕獲記 log */
    private async postSyncDaily(
        baseUrl: string,
        token: string,
        userName: string,
        records: SyncRecordItem[],
    ): Promise<SyncDailyResponseData> {
        const url = joinUrl(baseUrl, '/api/WorkCollect/sync-daily')
        const ctrl = new AbortController()
        const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS)
        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({userName, records}),
                signal: ctrl.signal,
            })
            if (!res.ok) {
                throw new Error(`HTTP ${res.status} ${res.statusText}`)
            }
            const json = await res.json()
            return extractData<SyncDailyResponseData>(json)
        } finally {
            clearTimeout(timer)
        }
    }

    /**
     * markSynced 失敗時短暫退避重試(對齊舊 renderer 行為):
     * 30ms / 90ms / 270ms,通常是 SQLite busy 一閃即過。
     */
    private async markSyncedWithRetry(
        localIds: number[],
        syncedAt: number,
    ): Promise<{ ok: boolean; reason?: string }> {
        let last: { ok: boolean; reason?: string } = {ok: false, reason: 'never tried'}
        for (let i = 0; i < 3; i++) {
            last = this.recordService.markSynced(localIds, syncedAt)
            if (last.ok) return last
            await sleep(30 * Math.pow(3, i))
        }
        return last
    }
}

function toSyncRecord(r: WorkRecord): SyncRecordItem {
    return {
        localId: r.id,
        capturedAt: r.capturedAt,
        activeApp: r.activeApp,
        activeWindowTitle: r.activeWindowTitle,
        category: r.category,
        description: r.description,
        confidence: r.confidence,
        screenshotHash: r.screenshotHash,
        reason: r.reason,
        activityState: r.activityState,
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms))
}

function errMsg(err: unknown): string {
    if (err instanceof Error) return err.message
    return String(err)
}

/** 安全拼接 baseUrl + path,避免 // 或缺 / */
function joinUrl(base: string, path: string): string {
    const b = base.endsWith('/') ? base.slice(0, -1) : base
    const p = path.startsWith('/') ? path : '/' + path
    return b + p
}
