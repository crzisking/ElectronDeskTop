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
 */

import axios from 'axios'
import type { AxiosInstance } from 'axios'
import { setupAuthInterceptor } from './interceptors/auth.interceptor'

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
 * 創建帶有完整攔截器的 Axios 實例
 *
 * @param baseURL  API 根地址（如 https://api.company.internal/v1）
 * @param timeout  請求超時毫秒數（默認 15000ms）
 * @returns 配置好的 AxiosInstance
 *
 * @example
 * const client = createHttpClient('https://api.company.internal/v1')
 * const { data } = await client.get('/contacts/search', { params: { q: 'IT' } })
 */
export function createHttpClient(baseURL: string, timeout = 15000): AxiosInstance {
  const instance = axios.create({
    baseURL,
    timeout,
    headers: {
      // 告知後端這是 Electron 桌面端請求，便於後端日誌區分
      'X-Client-Type': 'electron-desktop'
    }
  })

  // 附加完整攔截器（Token 注入 + 業務碼/HTTP錯誤/401過期 統一處理）
  setupAuthInterceptor(instance)

  return instance
}
