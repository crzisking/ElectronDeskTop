/**
 * 使用者身份同步 — 後端 API 薄包裝。
 *
 * 走 createHttpClient,複用 auth 攔截器(自動帶 JWT)+ 401 統一處理。
 * 失敗時 axios 攔截器內已有錯誤 toast 邏輯;本檔不重複處理,直接讓 caller catch。
 */

import {createHttpClient} from '@/api/http-client'
import type {DingUserResponse} from './types'

const USER_API_URL: string =
  (import.meta.env.VITE_USER_API_URL as string | undefined) ?? 'http://localhost:5247'

let _client: ReturnType<typeof createHttpClient> | null = null
function getClient() {
  if (!_client) {
    _client = createHttpClient(USER_API_URL, 30000)
  }
  return _client
}

export const userProfileApi = {
  /**
   * 取當前 JWT 用戶對應的釘釘員工資訊。
   * 後端從 JWT 解 userName,前端不必傳。
   *
   * 後端失敗(找不到 DingId / 釘釘 API 掛 / 解析失敗)會以 unified response Fail 返回,
   * http-client 攔截器會把 Fail 包成 throw,呼叫端 catch 即可拿到 errorMessage。
   */
  getDingUserInfo(): Promise<DingUserResponse> {
    // 路由 = ApiControllerBase 的 [Route("api/[controller]")] + 方法 [HttpGet("ding/userinfo")]
    return getClient().get<DingUserResponse>('/api/UserInfo/ding/userinfo')
  },
}
