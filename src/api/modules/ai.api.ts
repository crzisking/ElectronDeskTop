/**
 * AI 快捷功能 API 模塊
 *
 * 對接公司 AI 後端，提供三個工具的接口：
 *  1. textProcess  - 文本處理（潤色/翻譯/格式化）
 *  2. summarize    - 摘要生成
 *  3. qa（流式）   - 智能問答（SSE，見 useAiStream composable）
 *
 * baseURL 從 configStore.functionsConfig.apiBaseUrl 讀取，
 * 支持在 app-config.json 中切換到不同環境的 AI 服務。
 */

import { createHttpClient } from '../http-client'
import { useConfigStore } from '@/stores/config.store'
import type {
  TextProcessRequest,
  SummarizeRequest,
  AiResponse
} from '@/types/api.types'

/**
 * AI API Composable
 * 每次調用時從 configStore 讀取最新的 apiBaseUrl，
 * 支持配置熱更新後自動指向新地址。
 */
export function useAiApi() {
  const configStore = useConfigStore()

  // 從配置中讀取 AI API 地址（確保配置已加載）
  const baseURL = configStore.functionsConfig?.apiBaseUrl ?? 'https://ai-api.company.internal/v1'
  const client = createHttpClient(baseURL, 30000) // AI 接口超時設長一點（30s）

  return {
    /**
     * 文本處理
     * POST {aiBaseUrl}/text-process
     *
     * @param request 處理請求（文本 + 操作類型 + 目標語言）
     * @returns AI 處理結果
     *
     * @example
     * const result = await aiApi.textProcess({
     *   text: '这是需要润色的文本',
     *   operation: 'polish'
     * })
     */
    async textProcess(request: TextProcessRequest): Promise<AiResponse> {
      const { data } = await client.post<AiResponse>('/text-process', request)
      return data
    },

    /**
     * 摘要生成
     * POST {aiBaseUrl}/summarize
     *
     * @param request 摘要請求（長文本 + 可選的最大長度）
     * @returns 摘要結果
     */
    async summarize(request: SummarizeRequest): Promise<AiResponse> {
      const { data } = await client.post<AiResponse>('/summarize', request)
      return data
    }

    // 注意：智能問答（QA）使用 SSE 流式響應，
    // 不能用 Axios（Axios 不支持 ReadableStream），
    // 請使用 src/composables/useAiStream.ts 中的 streamQa() 方法
  }
}
