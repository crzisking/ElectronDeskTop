/**
 * AI 快捷功能相關類型
 *
 * 使用方：
 *  - src/api/modules/ai.api.ts
 *  - src/composables/useAiStream.ts
 */

/**
 * 文本處理請求
 * POST {aiBaseUrl}/text-process
 */
export interface TextProcessRequest {
  /** 待處理的原始文本 */
  text: string
  /**
   * 操作類型
   * - 'polish'    ：潤色（語法、用詞優化）
   * - 'translate' ：翻譯（配合 language 字段）
   * - 'format'    ：格式化（Markdown/JSON 等）
   */
  operation: 'polish' | 'translate' | 'format'
  /** 目標語言（translate 操作時必填） */
  language?: 'zh-TW' | 'zh-CN' | 'en' | 'ja'
}

/**
 * 摘要生成請求
 * POST {aiBaseUrl}/summarize
 */
export interface SummarizeRequest {
  /** 待摘要的長文本 */
  text: string
  /** 摘要最大字符數（可選，後端有默認值） */
  maxLength?: number
}

/**
 * 問答請求
 * POST {aiBaseUrl}/qa（支持 SSE 流式響應）
 */
export interface QaRequest {
  /** 當前問題 */
  question: string
  /** 補充上下文（可選） */
  context?: string
  /** 對話歷史（多輪對話時傳入） */
  history?: Array<{
    role: 'user' | 'assistant'
    content: string
  }>
}

/**
 * AI 功能通用非流式響應
 * 文本處理和摘要使用此格式；問答（QA）使用 SSE 流式，見 useAiStream.ts
 */
export interface AiResponse {
  /** AI 返回的結果文本 */
  result: string
  /** Token 消耗統計 */
  usage: {
    inputTokens: number
    outputTokens: number
  }
}
