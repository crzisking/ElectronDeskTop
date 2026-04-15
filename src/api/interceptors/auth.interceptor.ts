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

import type { AxiosInstance, InternalAxiosRequestConfig, AxiosResponse, AxiosError } from 'axios'
import { ElMessage, ElMessageBox, type Action } from 'element-plus'
import { useAuthStore } from '@/stores/auth.store'
import router from '@/router'

// ── 多語言錯誤訊息 ────────────────────────────────────────────────────
type ErrorKey =
  | 'TokenExpiredError'
  | 'Sys_Error'
  | 'ERR_NETWORK'
  | 'Session_expired'
  | 'OK'
  | 'Unauthorized_operation'
  | 'ERR_BAD_REQUEST'

const ERROR_MESSAGES: Record<string, Record<ErrorKey, string>> = {
  zh_TW: {
    TokenExpiredError:      '無效的令牌',
    Sys_Error:              '系統出錯',
    ERR_NETWORK:            '網絡連接錯誤',
    Session_expired:        '登錄已過期，點擊確認重新登錄。',
    OK:                     '確認',
    Unauthorized_operation: '當前操作未授權',
    ERR_BAD_REQUEST:        '未找到請求的資源',
  },
  zh_CN: {
    TokenExpiredError:      '无效的令牌',
    Sys_Error:              '系统出错',
    ERR_NETWORK:            '网络连接错误',
    Session_expired:        '登录已过期，点击确认重新登录。',
    OK:                     '确认',
    Unauthorized_operation: '当前操作未授权',
    ERR_BAD_REQUEST:        '未找到请求的资源',
  },
  en_US: {
    TokenExpiredError:      'Invalid token',
    Sys_Error:              'System error occurred',
    ERR_NETWORK:            'Network connection error',
    Session_expired:        'Session expired. Click to log in.',
    OK:                     'Confirm',
    Unauthorized_operation: 'Unauthorized operation.',
    ERR_BAD_REQUEST:        'The requested resource was not found',
  },
}

/**
 * 根據當前用戶語言取錯誤文案
 * 未登錄或語言不匹配時，回退到 zh_TW
 */
function getError(key: ErrorKey): string {
  const authStore = useAuthStore()
  const lang = authStore.user?.lang ?? 'zh_TW'
  const map = ERROR_MESSAGES[lang] ?? ERROR_MESSAGES['zh_TW']
  return map[key]
}

// ── 防止 401 彈窗重複彈出 ─────────────────────────────────────────────
let _sessionExpiredShowing = false

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
      } else {
        // 有接口調用但 token 為空（理論上路由守衛已攔截，此為兜底）
        ElMessage.error(getError('TokenExpiredError'))
      }

      return config
    },
    (error) => Promise.reject(error)
  )

  // ── 響應攔截器：業務碼 + HTTP 錯誤 ─────────────────────────────────
  instance.interceptors.response.use(
    (response: AxiosResponse) => {
      const { code, message } = response?.data ?? {}

      // HTTP 200 但業務碼異常（後端返回了錯誤業務碼）
      if (response.status === 200) {
        if (code && code !== 200) {
          ElMessage.error(`${code} - ${message}`)
        }
        return response.data
      }

      // 二進制流（Excel 導出等），直接透傳
      if (response.data instanceof ArrayBuffer) {
        return response
      }

      ElMessage.error(message ?? getError('Sys_Error'))
      return Promise.reject(new Error(message ?? 'Error'))
    },

    async (error: AxiosError) => {
      console.error('[HttpClient] 請求錯誤:', error)

      // 網絡斷線（無響應）
      if (error.code === 'ERR_NETWORK') {
        ElMessage.error(getError('ERR_NETWORK'))
        return Promise.reject(error)
      }

      switch (error.response?.status) {
        case 401: {
          // 防重複彈窗
          if (_sessionExpiredShowing) break
          _sessionExpiredShowing = true

          await ElMessageBox.alert(getError('Session_expired'), 'Warning', {
              confirmButtonText: getError('OK'),
              callback: async (_action: Action) => {
                  _sessionExpiredShowing = false
                  const authStore = useAuthStore()
                  await authStore.logout()
                  await router.push({name: 'login'})
              },
          })
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
