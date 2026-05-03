/**
 * Axios HTTP 客戶端工廠
 *
 * 使用工廠模式創建 Axios 實例，支持不同模塊使用不同 baseURL：
 *  - AI 功能 API：https://ai-api.company.internal/v1
 *  - 通用業務 API：https://api.company.internal/v1
 *
 * 每個創建的實例都會自動附加：
 *  - Auth 攔截器（注入 Bearer Token）
 *  - 錯誤攔截器（標準化 ApiError）
 *
 * 注意：HTTP Client 只存在於渲染進程（Renderer），
 * 主進程不做任何 HTTP 請求，職責分離清晰。
 *
 * ── 攔截器返回值約定 ────────────────────────────────────────────────
 * auth.interceptor 的響應攔截器會剝掉外層 { code, message, data }，
 * 直接返回 data（業務數據）。因此 API 模塊調用 client.post<T>() 時，
 * T 應該是業務數據的類型（而非包含 code/message 的外層類型），
 * 返回值直接就是 T 類型，不需要額外解構 { data }。
 */

import type {AxiosInstance, AxiosRequestConfig} from 'axios'
import axios from 'axios'
import {setupAuthInterceptor} from './interceptors/auth.interceptor'

/**
 * 從 Vite 環境變量讀取 API 配置
 * .env.development → npm run dev 時生效
 * .env.production  → npm run build 時生效
 */
export const ENV = {
  /** 通用業務 API 基礎地址 */
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8080/api/v1',
  /** 登錄/認證 API 基礎地址 */
  authBaseUrl: import.meta.env.VITE_AUTH_BASE_URL ?? 'http://localhost:8080/auth',
  /** 請求超時（ms） */
  apiTimeout: Number(import.meta.env.VITE_API_TIMEOUT ?? 30000),
}

/**
 * 類型安全的 API 客戶端接口。
 *
 * 攔截器已剝掉 { code, message, data } 外層，直接返回 data（業務數據），
 * 所以 post<T>() / get<T>() 的返回值就是 T 類型，而非 AxiosResponse<T>。
 * 這個接口讓 TypeScript 正確推斷返回類型，避免 API 模塊到處加 as 斷言。
 */
export interface ApiClient {
    get<T = unknown>(url: string, config?: AxiosRequestConfig): Promise<T>

    post<T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T>

    put<T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T>

    delete<T = unknown>(url: string, config?: AxiosRequestConfig): Promise<T>
}

/**
 * 創建帶有完整攔截器的 API 客戶端。
 *
 * 攔截器會剝掉後端返回的 { code, message, data } 外層，直接返回 data（業務數據），
 * 因此返回的 ApiClient 的泛型 T 直接對應業務數據類型。
 *
 * @param baseURL  API 根地址（如 https://api.company.internal/v1）
 * @param timeout  請求超時毫秒數（默認 15000ms）
 * @returns 類型安全的 ApiClient 實例
 *
 * @example
 * const client = createHttpClient('https://api.company.internal/v1')
 * // result 的類型直接是 UserProfile，不需要解構 { data }
 * const result = await client.get<UserProfile>('/user/profile')
 */
export function createHttpClient(baseURL: string, timeout = 15000): ApiClient {
    const instance: AxiosInstance = axios.create({
    baseURL,
    timeout,
    headers: {
      // 告知後端這是 Electron 桌面端請求，便於後端日誌區分
      'X-Client-Type': 'electron-desktop'
    }
  })

  // 附加完整攔截器（Token 注入 + 業務碼/HTTP錯誤/401過期 統一處理）
  setupAuthInterceptor(instance)

    // 返回類型安全的包裝，攔截器已返回 data，所以直接 as Promise<T>
    return {
        get: <T = unknown>(url: string, config?: AxiosRequestConfig) =>
            instance.get(url, config) as unknown as Promise<T>,
        post: <T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig) =>
            instance.post(url, data, config) as unknown as Promise<T>,
        put: <T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig) =>
            instance.put(url, data, config) as unknown as Promise<T>,
        delete: <T = unknown>(url: string, config?: AxiosRequestConfig) =>
            instance.delete(url, config) as unknown as Promise<T>,
    }
}
