/**
 * fetch-providers — 從 TMBOM 後端拉取 LLM provider 列表(stub)。
 *
 * 設計動機:
 *   - 企業內部統一發 key,後端是 source of truth
 *   - 前端啟動時拉一次,落地到 SQLite agent_configs.providers
 *   - 後續啟動先讀 SQLite(快、離線可用),只在使用者觸發「同步廠商」時重拉
 *
 * **目前是 stub**,因為後端端點還沒落實。完成 TMBOM API 後:
 *   1. 把 PROVIDER_ENDPOINT 改成真實路徑
 *   2. 用既有 `createHttpClient` 工廠(auth interceptor 會自動帶 Bearer token)
 *   3. 把後端回傳結構映射成 ProviderConfig[](命名差異在這裡 normalize,不污染 store)
 *
 * 呼叫方(AgentWindow.onMounted)在 SQLite providers 為空時調用本函式;
 * 拿到結果後 setProviders + writeConfig 落地。
 */

import type {ProviderConfig} from '../types'

/**
 * 後端預期回傳結構(示例,需跟 TMBOM 確認後對齊)。
 *
 * 約定:
 *   - 每個使用者一份 provider 清單,按使用者身份(JWT)區分
 *   - apiKey 由後端發,使用者不能編輯(但前端 UI 仍允許覆寫,本地優先)
 *   - 若使用者沒有任何 provider 權限,後端返回 []
 */
interface BackendProviderResponse {
    providers: Array<{
        id: string
        label: string
        baseUrl: string
        apiKey: string
        defaultModel?: string
    }>
}

/**
 * 從 TMBOM 後端拉取當前使用者可用的 provider 列表。
 *
 * 返回 null 表示「後端不可達 / 未配置 / 認證失敗」,呼叫方應該 fallback 到 SQLite 內既有資料。
 * 返回空陣列表示「使用者沒有任何 provider 權限」,呼叫方應該引導使用者手動添加。
 */
export async function fetchProvidersFromBackend(): Promise<ProviderConfig[] | null> {
    // TODO(tmbom-providers):接入 TMBOM 端點時開啟下面這段。
    //
    // 1. 端點路徑待後端確認(預期類似 /api/agent/providers)
    // 2. createHttpClient 會帶上現有 auth.interceptor(JWT)
    // 3. baseURL 從 env 或 config 拉
    //
    // 範例實作:
    // ```ts
    // import {createHttpClient} from '@/api/http-client'
    // const PROVIDER_ENDPOINT = '/api/agent/providers'
    // const client = createHttpClient(import.meta.env.VITE_AGENT_PROVIDER_API ?? '')
    // try {
    //   const resp = await client.get<BackendProviderResponse>(PROVIDER_ENDPOINT)
    //   return (resp.providers ?? []).map((p) => ({
    //     id: p.id,
    //     label: p.label,
    //     baseUrl: p.baseUrl,
    //     apiKey: p.apiKey,
    //     model: p.defaultModel ?? '',
    //   }))
    // } catch (err) {
    //   console.warn('[fetch-providers] 後端拉取失敗', err)
    //   return null
    // }
    // ```

    // 目前還沒接後端,直接返回 null;呼叫方會走 SQLite 既有資料 / DEFAULT_PROVIDERS。
    return null
}

/**
 * 主入口的初始化策略:
 *  - 若本地 SQLite 已有 providers → 直接用,不打後端
 *  - 否則嘗試後端拉一份;後端返回 null / 空 → fallback 到 DEFAULT_PROVIDERS(由 store 處理)
 *
 * 設計取捨:不每次啟動都打後端,避免:
 *   1. 內網不通時長時間 loading
 *   2. 後端意外刷掉使用者本地手動加的 provider
 * 「同步廠商」按鈕另外提供(P2 加),讓使用者主動刷。
 */
export async function initProvidersIfEmpty(
    existing: ProviderConfig[] | undefined,
): Promise<ProviderConfig[] | null> {
    if (existing && existing.length > 0) return null
    return await fetchProvidersFromBackend()
}

// 防止 unused interface 警告(BackendProviderResponse 暫時只用在註解內)
export type {BackendProviderResponse}
