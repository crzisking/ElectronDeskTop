/**
 * AI 快捷功能 API 模塊
 *
 * 對接公司 AI 後端，提供三個工具的接口：
 *  1. textProcess  - 文本處理（潤色/翻譯/格式化）
 *  2. summarize    - 摘要生成
 *
 * baseURL 從 configStore.functionsConfig.apiBaseUrl 讀取，
 * 支持在 app-config.json 中切換到不同環境的 AI 服務。
 * 緩存策略：配置不變時復用同一 Axios 實例，配置變化時自動重建。
 */

import {createHttpClient} from '../http-client'
import {useConfigStore} from '@/stores/config.store'
import type {AiResponse, SummarizeRequest, TextProcessRequest} from '@/types/api.types'

// ── 緩存的 Axios 實例與上次使用的 baseURL ──────────────────────────────
// 配置不變時復用實例，配置變化時自動重建，避免每次調用都創建新實例
let _client: ReturnType<typeof createHttpClient> | null = null
let _lastBaseURL: string | null = null

/**
 * 獲取或創建 Axios 實例。
 * 當 configStore 中的 apiBaseUrl 變化時，自動重建實例以支持配置熱更新。
 */
function getClient() {
    const configStore = useConfigStore()
    const baseURL = configStore.functionsConfig?.apiBaseUrl ?? ''

    // 配置變了就重建實例
    if (!_client || _lastBaseURL !== baseURL) {
        _client = createHttpClient(baseURL, 30000)
        _lastBaseURL = baseURL
    }
    return _client
}

/**
 * AI API Composable
 * 每次調用時從 configStore 讀取最新的 apiBaseUrl，
 * 支持配置熱更新後自動指向新地址。
 */
export function useAiApi() {
  return {
    /**
     * 文本處理
     * POST {aiBaseUrl}/text-process
     *
     * 攔截器已返回 data（業務數據），泛型 AiResponse 直接對應業務類型。
     *
     * @param request 處理請求（文本 + 操作類型 + 目標語言）
     * @returns AI 處理結果
     */
    async textProcess(request: TextProcessRequest): Promise<AiResponse> {
        return await getClient().post<AiResponse>('/text-process', request)
    },

    /**
     * 摘要生成
     * POST {aiBaseUrl}/summarize
     *
     * 攔截器已返回 data（業務數據），泛型 AiResponse 直接對應業務類型。
     *
     * @param request 摘要請求（長文本 + 可選的最大長度）
     * @returns 摘要結果
     */
    async summarize(request: SummarizeRequest): Promise<AiResponse> {
        return await getClient().post<AiResponse>('/summarize', request)
    }
  }
}
