/**
 * Auth Token 請求攔截器
 *
 * 在每個 HTTP 請求發出前，自動從 authStore 讀取 accessToken，
 * 並注入到請求頭的 Authorization 字段。
 *
 * 同時處理 401 響應（Token 失效場景）：
 *  - 清除本地 Token 和用戶狀態
 *  - 跳轉到登錄頁（登錄功能實現後啟用）
 *
 * 注意：Token 本身存儲在 OS 鑰匙串（主進程），
 * 這裡讀取的是 authStore 的內存副本（應用啟動時由 restoreSession 加載）。
 */

import type { AxiosInstance, InternalAxiosRequestConfig, AxiosResponse } from 'axios'
import { useAuthStore } from '@/stores/auth.store'

/**
 * 為指定 Axios 實例附加 Auth 攔截器
 * @param instance 要附加攔截器的 Axios 實例
 */
export function setupAuthInterceptor(instance: AxiosInstance): void {
  // ─── 請求攔截器：注入 Token ─────────────────────────────────
  instance.interceptors.request.use(
    (config: InternalAxiosRequestConfig) => {
      // 懶加載 store（避免在 store 初始化前調用）
      const authStore = useAuthStore()

      if (authStore.accessToken) {
        // Bearer Token 標準格式
        config.headers.Authorization = `Bearer ${authStore.accessToken}`
      }

      return config
    },
    (error) => Promise.reject(error)
  )

  // ─── 響應攔截器：處理 401 ────────────────────────────────────
  instance.interceptors.response.use(
    (response: AxiosResponse) => response,
    async (error) => {
      // Token 失效或未授權
      if (error.response?.status === 401) {
        const authStore = useAuthStore()

        // 清除認證狀態
        await authStore.logout()

        // TODO: 登錄功能實現後取消注釋，跳轉登錄頁
        // import router from '@/router'
        // router.push({ name: 'login' })

        console.warn('[AuthInterceptor] Token 已失效，請重新登錄')
      }

      return Promise.reject(error)
    }
  )
}
