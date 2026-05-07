/**
 * AI 流式輸出 Composable（SSE）
 *
 * 智能問答使用 Server-Sent Events 流式響應，
 * 實現打字機效果（AI 邊生成邊顯示）。
 *
 * 為什麼不用 Axios？
 *  Axios 會等待響應完全接收後才 resolve，
 *  而 SSE 是持續的數據流，必須使用 fetch API + ReadableStream。
 *
 * 使用方式：
 *  const { answerText, isStreaming, error, streamQa, stopStream } = useAiStream()
 *
 * SSE 數據格式（後端約定）：
 *  data: {"text": "部分回答文字"}\n\n
 *  data: [DONE]\n\n  （流結束標誌）
 */

import {ref} from 'vue'
import {useConfigStore} from '@/stores/config.store'
import {useAuthStore} from '@/stores/auth.store'
import {logger} from '@/utils/logger'
import type {QaRequest} from '@/types/api.types'

export function useAiStream() {
  // ─── State ──────────────────────────────────────────────────
  /** 累積的 AI 回答文本（流式追加） */
  const answerText = ref<string>('')

  /** 是否正在流式接收中 */
  const isStreaming = ref<boolean>(false)

  /** 錯誤信息（null 表示無錯誤） */
  const streamError = ref<string | null>(null)

  /** AbortController 用於取消正在進行的流式請求 */
  let abortController: AbortController | null = null

  // ─── Methods ────────────────────────────────────────────────
  /**
   * 發送問答請求並流式接收回答
   *
   * @param request 問答請求（問題 + 對話歷史）
   *
   * @example
   * await streamQa({ question: '什麼是 SSE？' })
   */
  async function streamQa(request: QaRequest): Promise<void> {
    // 如果有進行中的請求，先中止
    stopStream()

    const configStore = useConfigStore()
    const authStore = useAuthStore()

    const apiBaseUrl = configStore.functionsConfig?.apiBaseUrl ?? ''
    if (!apiBaseUrl) {
      // 原文：AI API 地址未配置（內部技術錯誤，保留原文便於日誌排查）
      streamError.value = 'AI API URL not configured'
      return
    }

    // 重置狀態
    answerText.value = ''
    streamError.value = null
    isStreaming.value = true

    abortController = new AbortController()

    try {
      const response = await fetch(`${apiBaseUrl}/qa`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // 注入 Auth Token
          ...(authStore.accessToken
            ? { Authorization: `Bearer ${authStore.accessToken}` }
            : {}),
          // 告知服務器客戶端接受 SSE 格式
          Accept: 'text/event-stream',
          'X-Client-Type': 'electron-desktop'
        },
        body: JSON.stringify(request),
        signal: abortController.signal
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      if (!response.body) {
        // 內部錯誤訊息（throw 出去後在 catch 裡再決定是否展示給用戶），保留原文
        throw new Error('Empty response body: server may not support streaming')
      }

      // 使用 ReadableStream 逐塊讀取 SSE 數據
      const reader = response.body.getReader()
      const decoder = new TextDecoder('utf-8')

        /** SSE 行緩衝區：累積跨 chunk 的不完整行，避免數據丟失 */
        let lineBuffer = ''

        /**
         * 處理單行 SSE 數據
         * 提取 'data: ' 前綴的內容，解析 JSON 並追加到回答文本
         */
        function processLine(line: string): void {
            if (!line.startsWith('data: ')) return
            const dataStr = line.slice(6).trim()
            if (!dataStr) return

            if (dataStr === '[DONE]') {
                isStreaming.value = false
                return
            }

            try {
                const parsed = JSON.parse(dataStr) as { text?: string; content?: string }
                const text = parsed.text ?? parsed.content ?? ''
                if (text) answerText.value += text
            } catch {
                if (dataStr) answerText.value += dataStr
            }
        }

        while (true) {
            const {done, value} = await reader.read()

            if (done) {
                // 串流結束時處理緩衝區中殘留的數據
                if (lineBuffer) {
                    processLine(lineBuffer)
                }
                break
            }

            // 解碼二進制數據，stream: true 確保多位元組字符跨 chunk 正確拼接
            const chunk = decoder.decode(value, {stream: true})

            // 將新數據拼接到緩衝區，再按換行符切分
            // 最後一段可能是不完整的行，保留在緩衝區等待下一個 chunk
            const parts = (lineBuffer + chunk).split('\n')
            lineBuffer = parts.pop() ?? ''

            for (const line of parts) {
                processLine(line)
        }
      }
    } catch (err) {
      // AbortError 是主動取消，不算錯誤
      if (err instanceof Error && err.name === 'AbortError') {
        return
      }
      streamError.value = err instanceof Error ? err.message : 'Stream request failed'
      logger.error('流式請求錯誤', 'useAiStream', err)
    } finally {
      isStreaming.value = false
      abortController = null
    }
  }

  /**
   * 停止當前流式請求
   * 適用場景：用戶點擊"停止生成"按鈕
   */
  function stopStream(): void {
    if (abortController) {
      abortController.abort()
      abortController = null
      isStreaming.value = false
    }
  }

  /** 清空回答內容 */
  function clearAnswer(): void {
    answerText.value = ''
    streamError.value = null
  }

  return {
    answerText,
    isStreaming,
    streamError,
    streamQa,
    stopStream,
    clearAnswer
  }
}
