/**
 * fetch-models — 從 OpenAI 兼容端點拉 model 列表(`GET /models`)。
 *
 * 為何不用 openai SDK 的 `client.models.list()`:
 *   - 我們已經有 `apiKey + baseUrl`,直接 fetch 比 new 一個 client 輕
 *   - SDK 在某些 4xx 場景會包裝錯誤訊息,fetch 拿原文更好排查
 *
 * 結果過濾(對應使用者要求「不要顯示太多」):
 *   - 排除嵌入 / 視覺 / 音頻 / 微調等非聊天用途的 model
 *   - 命中 `keep` heuristic 的優先排序在前
 *   - 上限 25 個(每家主流廠商 chat 系列也就 10+ 個,夠用)
 *
 * 緩存策略:模組級 Map,key = `${baseUrl}|${apiKey 前 8 字}`,
 *   - 同一窗口生命週期內,同 provider 只 fetch 一次
 *   - 用 apiKey 前綴當區分,避免換 key 後拿到舊結果
 *   - 不持久化(換窗口 / 換對話 / reload 都重新拉,模型清單變動才能被感知)
 */

interface ModelListItem {
    id: string
    /** Unix timestamp(秒)。OpenAI 兼容 API 規範欄位,Qwen / DeepSeek 都有。 */
    created?: number

    [k: string]: unknown
}

/** OpenAI 兼容 `GET /models` 的回應結構 */
interface ModelListResponse {
    data?: ModelListItem[]
    models?: ModelListItem[]  // 某些非標準實作放在 models 而非 data
}

const cache = new Map<string, string[]>()

/**
 * 排除明顯不是 chat 的 model(嵌入 / 視覺 / 音頻 / 圖像生成 / 微調)。
 *
 * 日期 snapshot 過濾撤掉了 ——
 *   廠商在 model 物件上有 `created` Unix 時間戳,直接按時間倒序取最新 N 個更直接。
 *   想要 `qwen-plus-2025-12-01` 鎖版本的人也直接看得到。
 */
const SKIP_PATTERNS = [
    /embed/i,
    /text-similarity/i,
    /tts/i,
    /whisper/i,
    /audio/i,
    /-asr-/i,
    /image/i,
    /-vl-/i,
    /vision/i,
    /-realtime-/i,
    /\bdalle?\b/i,
    /\bgpt-image\b/i,
    /-fine-?tune/i,
    /-ft-/i,
    /-training/i,
    /-staging$/i,
    /-test$/i,
] as const

function shouldSkip(id: string): boolean {
    return SKIP_PATTERNS.some((re) => re.test(id))
}

/**
 * 拉取並過濾 model 列表。
 *
 * @param baseUrl OpenAI 兼容根路徑(末尾有 / 也接受,內部會處理)
 * @param apiKey  Authorization Bearer
 * @returns       model id 陣列(已篩 + 排序 + 限量),失敗時返回空陣列
 */
export async function fetchModels(baseUrl: string, apiKey: string): Promise<string[]> {
    if (!baseUrl || !apiKey) return []

    const cacheKey = `${baseUrl}|${apiKey.slice(0, 8)}`
    const cached = cache.get(cacheKey)
    if (cached) return cached

    const url = `${baseUrl.replace(/\/$/, '')}/models`

    try {
        const res = await fetch(url, {
            method: 'GET',
            headers: {
                Authorization: `Bearer ${apiKey}`,
                Accept: 'application/json',
            },
        })
        if (!res.ok) {
            console.warn(`[fetchModels] ${url} 返回 ${res.status},放棄`)
            return []
        }
        const json = (await res.json()) as ModelListResponse
        const rawList = json.data ?? json.models ?? []

        // 篩掉非 chat 用途 + id 合法檢查
        const filtered = rawList.filter(
            (m): m is ModelListItem & { id: string } =>
                m.id.length > 0 && !shouldSkip(m.id),
        )

        // 按 created 倒序:廠商給每個 model 都帶 Unix 時間戳,新的在前。
        // 沒給 created 的(極少數實作)排到最後,不至於擠掉有時間戳的條目。
        filtered.sort((a, b) => (b.created ?? 0) - (a.created ?? 0))

        // 取最新 40 個 id
        const out = filtered.slice(0, 40).map((m) => m.id)
        cache.set(cacheKey, out)
        return out
    } catch (err) {
        console.warn('[fetchModels] 失敗', err)
        return []
    }
}

/** 手動清掉某個 provider 的緩存(編輯 baseUrl/apiKey 後呼叫) */
export function invalidateModelsCache(baseUrl: string, apiKey: string): void {
    cache.delete(`${baseUrl}|${apiKey.slice(0, 8)}`)
}
