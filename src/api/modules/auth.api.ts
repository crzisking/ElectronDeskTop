/**
 * Auth API 模塊
 *
 * 負責與後端 Portal OAuth 服務通信（登錄接口）。
 * Token 的持久化存取走 IPC → OS 鑰匙串（見 electron/preload/index.ts），
 * 此模塊只負責 HTTP 層的登錄請求。
 */

import { createHttpClient, ENV } from '../http-client'
import type { LoginCredentials, LoginResponse } from '@/types/api.types'

/**
 * Auth API 模塊
 *
 * 對接 Portal OAuth 登錄接口：
 *   POST http://192.168.120.71:9222/api/portal/oauth/login
 *
 * API 宿主由環境變量控制：
 *   開發環境 → .env.development 的 VITE_AUTH_BASE_URL
 *   正式環境 → .env.production  的 VITE_AUTH_BASE_URL
 */

/** Auth Axios 實例（單例，懶創建） */
let _client: ReturnType<typeof createHttpClient> | null = null
function getClient() {
  if (!_client) {
    _client = createHttpClient(ENV.authBaseUrl, ENV.apiTimeout)
  }
  return _client
}

export const authApi = {
  /**
   * 登錄
   * POST /api/portal/oauth/login
   * Body: { username, password }
   * Response: { code, message, data: { user, token } }
   */
  async login(credentials: LoginCredentials): Promise<LoginResponse> {
    const { data } = await getClient().post<LoginResponse>(
      '/api/portal/oauth/login',
      credentials
    )
    return data
  }
}
