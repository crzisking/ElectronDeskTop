/**
 * 工作分析聚合器 — 把 work_records raw rows 壓縮成餵 LLM 的結構化 payload。
 *
 * 為何不能直接把 raw records 送 LLM:
 *   - 一天 100 筆 × 描述 200 字 = 20K token,光 input 就要花一筆錢
 *   - LLM 對重複資訊敏感度差,堆雜訊反而拉低分析品質
 *   - 結構化摘要讓 prompt-builder 端的 instruction 更明確
 *
 * 壓縮策略(對齊 doc/19 風格 — 邊界清楚、單一職責):
 *   1. 過濾 idle 紀錄(activityState='idle' 從來不該進報告)
 *   2. 按 category 聚合佔比
 *   3. 按 hour 找 dominant category(時段識別)
 *   4. 應用 / 視窗 top-N 排名
 *   5. 偵測重複描述(可優化機會的訊號)
 *   6. 切換頻率(fragmentationIndex)
 *   7. 隨機抽 ~10 條代表性 description 給 AI 看具體 context
 *
 * 輸出結構固定,prompt-builder 直接 JSON.stringify 進 user message。
 */

import type {WorkRecord} from '../db/features'

const TAG = 'WorkAnalysisAggregator'

/** 報告時段內各分類的時間佔比 */
export interface CategorySlice {
    /** 分類 code(對應模板 item.code) */
    code: string
    /** 出現次數 */
    count: number
    /** 估算分鐘數(count × intervalMinutes,intervalMinutes 由 caller 傳) */
    minutes: number
    /** 0~1,該分類在報告時段內的佔比 */
    ratio: number
}

/** 每小時主導分類 */
export interface HourlyDominant {
    /** 0-23 */
    hour: number
    /** 該小時佔比最高的分類 code,沒紀錄為 null */
    code: string | null
}

/** Top 應用 / 視窗 */
export interface AppRank {
    name: string
    count: number
    minutes: number
}

/** 重複描述 pattern — 多次出現同 / 高度相似描述,提示可優化 */
export interface RepetitivePattern {
    /** 代表性描述(從 group 內挑一條) */
    sample: string
    /** group size */
    occurrences: number
}

/**
 * 餵 LLM 的完整聚合資料。
 * prompt-builder 會 JSON.stringify 直接放進 user message。
 * 欄位 / 命名是 prompt 契約的一部分,改了同步改 prompt-builder。
 */
export interface AnalysisInputPayload {
    /** YYYY-MM-DD HH:mm → YYYY-MM-DD HH:mm */
    timeRange: string
    /** 範圍長度(小時),AI 用此決定看細節還是看趨勢 */
    rangeLengthHours: number
    /** 使用者崗位(模板 name + description,模板沒設就 fallback) */
    userRole: string
    /** 過濾掉 idle 之後的有效紀錄數 */
    totalRecords: number
    /** 採集間隔(分鐘) — 算 minutes 用 */
    intervalMinutes: number
    /** 各分類佔比(按 count desc) */
    categories: CategorySlice[]
    /** 每小時主導分類 */
    hourlyDominant: HourlyDominant[]
    /** 應用排名,top 5 */
    topApps: AppRank[]
    /** 重複描述偵測結果 */
    repetitivePatterns: RepetitivePattern[]
    /**
     * 切換頻率(fragmentationIndex)0~1。
     * 計算:相鄰 record 「category 不同」次數 / (totalRecords - 1)。
     * 越接近 1 越碎片化,越接近 0 越深度工作。
     */
    fragmentationIndex: number
    /**
     * 代表性 description 樣本,~10 條。
     * 隨機抽,給 AI 看實際做了什麼(避免 LLM 只看分類佔比就亂下結論)。
     */
    descriptionSamples: string[]
}

/** 模板 minimal 結構(避免 import 完整 CachedTemplateDetail) */
export interface AggregatorTemplate {
    name?: string | null
    description?: string | null
    /** code → label;用於 categories 內若 LLM 需要中文時可查 */
    labelByCode: Record<string, string>
}

/** aggregate 的選項 */
export interface AggregateOptions {
    /** 採集間隔分鐘數(從 config 拿) */
    intervalMinutes: number
    /** 報告時段起點(Unix ms),含 */
    rangeStart: number
    /** 報告時段終點(Unix ms),不含 */
    rangeEnd: number
    /** 樣本數上限,預設 10 */
    sampleSize?: number
    /** 應用 top N,預設 5 */
    topAppsN?: number
}

/**
 * 主入口:WorkRecord[] → AnalysisInputPayload。
 *
 * records 必須是「已過濾到該時段」的;本函式內部會再過濾 idle / 排除空欄位,
 * 但不再做時段過濾(避免重複職責)。
 */
export function aggregate(
    records: WorkRecord[],
    template: AggregatorTemplate,
    opts: AggregateOptions,
): AnalysisInputPayload {
    const sampleSize = opts.sampleSize ?? 10
    const topAppsN = opts.topAppsN ?? 5

    // 過濾 idle — UI 從來不顯示,分析也跳過
    const active = records.filter((r) => r.activityState !== 'idle')
    const total = active.length

    // ── 1. categories 佔比 ─────────────────────────────────────────
    const categoryCounts = new Map<string, number>()
    for (const r of active) {
        categoryCounts.set(r.category, (categoryCounts.get(r.category) ?? 0) + 1)
    }
    const categories: CategorySlice[] = [...categoryCounts.entries()]
        .map(([code, count]) => ({
            code,
            count,
            minutes: count * opts.intervalMinutes,
            ratio: total > 0 ? count / total : 0,
        }))
        .sort((a, b) => b.count - a.count)

    // ── 2. 每小時 dominant ─────────────────────────────────────────
    const perHour = new Map<number, Map<string, number>>()
    for (const r of active) {
        const h = new Date(r.capturedAt).getHours()
        let bucket = perHour.get(h)
        if (!bucket) {
            bucket = new Map()
            perHour.set(h, bucket)
        }
        bucket.set(r.category, (bucket.get(r.category) ?? 0) + 1)
    }
    const hourlyDominant: HourlyDominant[] = []
    for (let h = 0; h < 24; h++) {
        const bucket = perHour.get(h)
        if (!bucket) continue // 沒紀錄的小時直接跳過,不寫進 payload
        let topCat: string | null = null
        let topCount = 0
        for (const [cat, c] of bucket) {
            if (c > topCount) {
                topCat = cat
                topCount = c
            }
        }
        hourlyDominant.push({hour: h, code: topCat})
    }

    // ── 3. 應用 top-N ──────────────────────────────────────────────
    const appCounts = new Map<string, number>()
    for (const r of active) {
        const name = (r.activeApp ?? '').trim()
        if (!name) continue
        appCounts.set(name, (appCounts.get(name) ?? 0) + 1)
    }
    const topApps: AppRank[] = [...appCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, topAppsN)
        .map(([name, count]) => ({
            name,
            count,
            minutes: count * opts.intervalMinutes,
        }))

    // ── 4. 重複描述偵測 ───────────────────────────────────────────
    //   策略:把 description 取前 30 字當 key 分桶,組裡 ≥ 3 條算重複 pattern,
    //   不做 fuzzy match(成本太高,前 30 字夠用)
    const descGroups = new Map<string, string[]>()
    for (const r of active) {
        const d = (r.description ?? '').trim()
        if (!d) continue
        const key = d.slice(0, 30).toLowerCase()
        const arr = descGroups.get(key) ?? []
        arr.push(d)
        descGroups.set(key, arr)
    }
    const repetitivePatterns: RepetitivePattern[] = []
    for (const [, arr] of descGroups) {
        if (arr.length >= 3) {
            repetitivePatterns.push({sample: arr[0], occurrences: arr.length})
        }
    }
    repetitivePatterns.sort((a, b) => b.occurrences - a.occurrences)

    // ── 5. fragmentationIndex ─────────────────────────────────────
    let switches = 0
    for (let i = 1; i < active.length; i++) {
        if (active[i].category !== active[i - 1].category) switches++
    }
    const fragmentationIndex = active.length > 1 ? switches / (active.length - 1) : 0

    // ── 6. description samples ────────────────────────────────────
    //   隨機抽(用「按時間均勻取樣」近似隨機,避免依賴 Math.random 不可重現)
    const samples: string[] = []
    if (active.length > 0) {
        const step = Math.max(1, Math.floor(active.length / sampleSize))
        for (let i = 0; i < active.length && samples.length < sampleSize; i += step) {
            const d = (active[i].description ?? '').trim()
            if (d) samples.push(d)
        }
    }

    // ── 7. 組 userRole 字串 ────────────────────────────────────────
    const userRole = [template.name, template.description].filter(Boolean).join(' · ')
        || '一般使用者'

    void TAG  // tag 保留給未來 logger.debug 用
    void template.labelByCode  // 暫不在 payload 內展開 label;若 prompt 要中文 label,prompt-builder 自己查

    return {
        timeRange: `${formatTime(opts.rangeStart)} → ${formatTime(opts.rangeEnd)}`,
        rangeLengthHours: Math.round((opts.rangeEnd - opts.rangeStart) / 3_600_000),
        userRole,
        totalRecords: total,
        intervalMinutes: opts.intervalMinutes,
        categories,
        hourlyDominant,
        topApps,
        repetitivePatterns,
        fragmentationIndex: Number(fragmentationIndex.toFixed(2)),
        descriptionSamples: samples,
    }
}

/** YYYY-MM-DD HH:mm,本地時區 */
function formatTime(ms: number): string {
    const d = new Date(ms)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
