/**
 * 統一錯誤處理攔截器
 *
 * 將 Axios 的各種錯誤形式（網絡錯誤、超時、HTTP 錯誤碼）
 * 統一標準化為 ApiError 格式，讓業務組件只需處理一種錯誤結構。
 *
 * ApiError 格式：
 *  { code: string, message: string, statusCode: number, details?: unknown }
 */

import axios from 'axios'
import type { AxiosInstance } from 'axios'
import type { ApiError } from '@/types/api.types'

/**
 * 為指定 Axios 實例附加錯誤標準化攔截器
 * @param instance 要附加攔截器的 Axios 實例
 */
export function setupErrorInterceptor(instance: AxiosInstance): void {
  instance.interceptors.response.use(
    // 成功響應直接透傳
    (response) => response,

    // 錯誤響應標準化
    (error: unknown) => {
      const apiError = normalizeError(error)
      // 將標準化後的 ApiError 作為 rejection reason
      return Promise.reject(apiError)
    }
  )
}

/**
 * 將任意錯誤標準化為 ApiError
 *
 * 覆蓋三種情況：
 *  1. Axios 響應錯誤（後端返回 4xx/5xx）
 *  2. Axios 請求錯誤（網絡中斷、超時）
 *  3. 未知錯誤（非 Axios 錯誤）
 *
 * @param error 原始錯誤
 * @returns 標準化的 ApiError
 */
export function normalizeError(error: unknown): ApiError {
  if (axios.isAxiosError(error)) {
    if (error.response) {
      // 情況1：服務器返回了響應，但狀態碼表示錯誤
      const data = error.response.data as Record<string, unknown> | undefined
      return {
        code: (data?.code as string) ?? `HTTP_${error.response.status}`,
        message:
          (data?.message as string) ??
          (data?.error as string) ??
          error.message ??
          '請求失敗',
        statusCode: error.response.status,
        details: data
      }
    }

    if (error.request) {
      // 情況2：請求已發出但未收到響應（網絡問題/超時）
      const isTimeout = error.code === 'ECONNABORTED'
      return {
        code: isTimeout ? 'REQUEST_TIMEOUT' : 'NETWORK_ERROR',
        message: isTimeout ? '請求超時，請檢查網絡連接' : '網絡異常，無法連接到服務器',
        statusCode: 0
      }
    }
  }

  // 情況3：其他錯誤（如代碼邏輯錯誤）
  return {
    code: 'CLIENT_ERROR',
    message: error instanceof Error ? error.message : String(error),
    statusCode: 0
  }
}
