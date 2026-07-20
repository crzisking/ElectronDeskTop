/**
 * 工作採集 — HTTP 請求削峰排程器(client-side jitter)。
 *
 * 場景:
 *   500 台 desktop 同時對 server 發請求,易出現的峰值場景三條:
 *     A. 整點 / 整 5 分鐘 tick 對齊 → /analyze 同秒 500 req
 *     B. 17:00 工時結束 → /sync-daily 同秒 500 req
 *     C. 08:00 每天 config 拉取 → /my-config 同秒 500 req
 *
 *   雖然啟動時 scheduler 已有 50% interval 的 jitter 分散了 tick,
 *   但事件型觸發(work-end / startup / safety-net)沒這層保護,
 *   而 /analyze 在 tick 內也是「拍到圖立刻發」,沒有額外散開。
 *
 * 解決:統一在 api.ts 入口套這個 schedule(),每筆請求發出前先 random delay [0, spreadMs)。
 *   500 / spreadMs(預設 25s)≈ 20 req/s 峰值,server 單實例 hold 得住(docs/11)。
 *
 * 為什麼不在 server 端做 rate limit:
 *   - server 拒絕請求 → desktop 還是會重試 → 沒削到峰
 *   - 真正要降到 server 的負載必須在 client 端就分散
 *
 * 為什麼不用「全機統一排程器」(主進程一個 queue):
 *   - 我們要削的是「跨機器」的同秒峰值,不是單機自己的並發
 *   - 單機每分鐘也就 1-3 個 HTTP,本機並發從來不是瓶頸
 *   - 全機 queue 反而會把同機 sync 串行化,拖長 work-end 完成時間
 *
 * 因此:純無狀態 random delay,單機極簡。
 */

import {logger} from '@/shared/utils/logger'

/** server 目標峰值(docs/11 估算 20 req/s 為單實例上限) */
const TARGET_PEAK_RPS = 20

/** 規模假設:同時在線採集人數;若上 1000 人要把 spread 拉到 50s */
const POPULATION = 500

/**
 * 預設散佈窗口(ms)。
 *   spreadMs ≈ ceil(POPULATION / TARGET_PEAK_RPS) * 1000
 *   500 / 20 → 25 秒,500 台機器在這 25s 內隨機發 → 平均 20 req/s。
 *
 * 算式刻意保留為 const 而非執行期計算 ── 改規模請改常數 + commit,不希望任何 runtime 注入。
 */
const DEFAULT_SPREAD_MS = Math.ceil(POPULATION / TARGET_PEAK_RPS) * 1000

/**
 * /analyze 用較短的 spread。
 *   - tick 之間本來就有 N 分鐘間隔,單機請求量不大
 *   - 加 15s 內隨機延遲足以對齊「不要 500 台同秒砸」
 *   - 不能延遲太久,否則 AI 結果回到 UI 太慢、體感差
 */
const ANALYZE_SPREAD_MS = 15_000

/** 不同類型 API 的散佈設定 */
export type ScheduleProfile = 'analyze' | 'sync-daily' | 'config' | 'custom'

interface ScheduleOptions {
    profile?: ScheduleProfile
    /** 自訂散佈窗口(僅 profile='custom' 時用) */
    spreadMs?: number
    /** 標籤,只供 log;不影響行為 */
    label?: string
}

function pickSpreadMs(opts?: ScheduleOptions): number {
    if (opts?.profile === 'analyze') return ANALYZE_SPREAD_MS
    if (opts?.profile === 'custom' && typeof opts.spreadMs === 'number') return Math.max(0, opts.spreadMs)
    // sync-daily / config / 預設 → 25s 散佈
    return DEFAULT_SPREAD_MS
}

/**
 * 排程一個 HTTP 請求:
 *   1. 算 random delay ∈ [0, spreadMs)
 *   2. 等延遲
 *   3. 執行 fn
 *
 * 失敗不重試 ── 重試請呼叫方自己決定(/sync-daily 失敗 → 等下次 work-end / safety-net;
 * /my-config 失敗 → 等隔天 08:00 或下次啟動)。
 */
export async function scheduleRequest<T>(
    fn: () => Promise<T>,
    opts?: ScheduleOptions,
): Promise<T> {
    const spread = pickSpreadMs(opts)
    // Math.random() 各機獨立 → 跨機分佈期望均勻
    const delay = Math.floor(Math.random() * spread)
    const label = opts?.label ?? opts?.profile ?? 'unknown'

    if (delay > 0) {
        logger.debug(`scheduleRequest ${label} 延遲 ${delay}ms`, 'WorkCollect:scheduler')
        await sleep(delay)
    }
    return fn()
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
}
