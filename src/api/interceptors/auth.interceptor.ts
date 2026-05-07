/**
 * HTTP 攔截器（請求 + 響應統一處理）
 *
 * 對齊公司 Portal 前端的 HttpClient 實現：
 *  - 請求攔截：自動注入 JWT Token
 *  - 響應攔截：業務碼錯誤提示、401 過期彈窗、網絡/404/403 錯誤提示
 *
 * 差異點（Electron 適配）：
 *  - 401 後 → router.push('login') + authStore.logout()（不用 window.parent.postMessage）
 *  - 語言從 authStore.user.lang 讀取（與 Portal 的 OAuthStore 對應）
 */

import type {AxiosError, AxiosInstance, AxiosResponse, InternalAxiosRequestConfig} from 'axios'
import {ElMessage, ElMessageBox} from 'element-plus'
import {useAuthStore} from '@/stores/auth.store'
import {logger} from '@/utils/logger'
import router from '@/router'
import {i18n} from '@/locales'

// ── 多語言錯誤訊息 ────────────────────────────────────────────────────
//
// 之前自帶 ERROR_MESSAGES 表 + 從 authStore.user.lang 取語言；
// 全應用上 i18n 後改為直接讀 vue-i18n 全局實例，與其他組件共用同一份字典，
// 切換語言後錯誤提示也自動跟著變。
//
// 原文映射（保留方便排查）：
//   TokenExpiredError      → 無效的令牌 / Invalid token
//   Sys_Error              → 系統出錯 / System error occurred
//   ERR_NETWORK            → 網絡連接錯誤 / Network connection error
//   Session_expired        → 登錄已過期，點擊確認重新登錄。
//   OK                     → 確認 / Confirm
//   Unauthorized_operation → 當前操作未授權
//   ERR_BAD_REQUEST        → 未找到請求的資源
type ErrorKey =
  | 'TokenExpiredError'
  | 'Sys_Error'
  | 'ERR_NETWORK'
  | 'Session_expired'
  | 'OK'
  | 'Unauthorized_operation'
  | 'ERR_BAD_REQUEST'

/** 把舊的錯誤分類碼映射到 i18n key，外面繼續用 getError(key) 不變 */
const ERROR_KEY_MAP: Record<ErrorKey, string> = {
  TokenExpiredError:      'http.tokenExpired',
  Sys_Error:              'http.sysError',
  ERR_NETWORK:            'http.networkError',
  Session_expired:        'http.sessionExpired',
  OK:                     'common.confirm',
  Unauthorized_operation: 'http.unauthorized',
  ERR_BAD_REQUEST:        'http.notFound'
}

/** 取錯誤文案：直接走 i18n 全局實例，跟隨當前語言 */
function getError(key: ErrorKey): string {
  return i18n.global.t(ERROR_KEY_MAP[key])
}

// ── 防止 401 彈窗重複彈出 ─────────────────────────────────────────────
//
// 為什麼用 Promise 而非 boolean 標誌：
//   舊實作用同步 boolean `_sessionExpiredShowing`，在 await 與 callback
//   之間有夾縫期：第一個 401 的 callback 把標誌設回 false 那一瞬間，
//   並發中的其他 401 仍會把標誌再次設 true 並彈第二個窗。
//
//   改用 Promise 級聯：第一個 401 創建 Promise 並保存；後續 401 直接
//   返回同一個 Promise，全程只彈一次窗、只跳一次登錄。Promise resolve
//   後（用戶點確認 + logout + router.push 完成）才把引用清空，下一輪
//   會話過期能正常觸發。
let _sessionExpiredPromise: Promise<void> | null = null

/**
 * 為指定 Axios 實例附加完整的請求/響應攔截器
 * @param instance 要附加攔截器的 Axios 實例
 */
export function setupAuthInterceptor(instance: AxiosInstance): void {

  // ── 請求攔截器：注入 Token ──────────────────────────────────────────
  instance.interceptors.request.use(
    (config: InternalAxiosRequestConfig) => {
      const authStore = useAuthStore()
      const token = authStore.accessToken

      if (token) {
        // 直接帶 token（與 Portal HttpClient 保持一致，不加 Bearer 前綴）
        config.headers.Authorization = 'Bearer '+token
      }
      // token 為空時靜默放行（未登錄狀態下發起的請求會被後端拒絕，
      // 由響應攔截器的 401 處理統一跳轉登錄頁）

      return config
    },
    (error) => Promise.reject(error)
  )

  // ── 響應攔截器：業務碼 + HTTP 錯誤 ─────────────────────────────────
    // 約定：後端返回格式為 { code, message, data }，攔截器直接返回 data（業務數據），
    // 這樣 API 模塊的泛型 T 直接對應業務類型，不需要額外解構或 as 斷言。
  instance.interceptors.response.use(
    (response: AxiosResponse) => {
        const {code, message, data} = response?.data ?? {}

      // HTTP 200 但業務碼異常（後端返回了錯誤業務碼）
      if (response.status === 200) {
        if (code && code !== 200) {
          ElMessage.error(`${code} - ${message}`)
            // 業務碼錯誤時 reject，調用方不會拿到錯誤數據
            return Promise.reject(new Error(`${code} - ${message}`))
        }
          // 直接返回業務數據，API 模塊的泛型 T 對應此值
          return data
      }

        // 二進制流（Excel 導出等），直接透傳完整 response
      if (response.data instanceof ArrayBuffer) {
        return response
      }

      ElMessage.error(message ?? getError('Sys_Error'))
      return Promise.reject(new Error(message ?? 'Error'))
    },

    async (error: AxiosError) => {
      logger.error('HTTP 請求錯誤', 'HttpClient', error)

      // 網絡斷線（無響應）
      if (error.code === 'ERR_NETWORK') {
        ElMessage.error(getError('ERR_NETWORK'))
        return Promise.reject(error)
      }

      switch (error.response?.status) {
        case 401: {
          // 並發 401 全部復用同一個 Promise，避免多次彈窗 / 多次跳轉
          if (!_sessionExpiredPromise) {
            _sessionExpiredPromise = ElMessageBox
                .alert(getError('Session_expired'), 'Warning', {
                  confirmButtonText: getError('OK')
                })
                .then(async () => {
                  const authStore = useAuthStore()
                  await authStore.logout()
                  await router.push({name: 'login'})
                })
                .catch(async () => {
                  // 用戶點 X 關閉彈窗也走相同流程，避免懸空狀態
                  const authStore = useAuthStore()
                  await authStore.logout()
                  await router.push({name: 'login'})
                  // 顯式 return undefined，否則 router.push 的 NavigationFailure
                  // 會讓 catch 回呼的返回類型推導成非 void，破壞外層 Promise<void>
                })
                .finally(() => {
                  // 清空引用，允許下一輪會話過期再次觸發
                  _sessionExpiredPromise = null
                })
          }
          // 所有 401 都 await 同一個 Promise；Promise 完成後 reject 原始錯誤，
          // 讓上層感知到失敗（也維持與其他 case 行為一致）
          await _sessionExpiredPromise
          break
        }

        case 403: {
          // 同 404：不 await，彈窗異步顯示，reject 立即傳播
          ElMessageBox.alert(getError('Unauthorized_operation'), 'Warning', {
              confirmButtonText: getError('OK'),
              callback: () => {
              },
          })
          break
        }

        case 404: {
          // 不 await：彈窗異步顯示，reject 立即傳播（loading spinner 不需等用戶點確認才停）
          ElMessageBox.alert(getError('ERR_BAD_REQUEST'), 'Warning', {
              confirmButtonText: getError('OK'),
              callback: () => {
              },
          })
          break
        }

        default: {
          ElMessage.error(error.message ?? getError('Sys_Error'))
          break
        }
      }

      return Promise.reject(error)
    }
  )
}
