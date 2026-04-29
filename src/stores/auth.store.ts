/**
 * 認證狀態（token / user / isAuthenticated）。
 * 用於：路由守衛 router/index.ts、HTTP 攔截器、登錄登出組件。
 * Token 持久化在 OS 鑰匙串（透過 window.electronAPI.auth），記憶體只保留副本供攔截器讀取。
 */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { UserProfile } from '@/types/api.types'
import { authApi } from '@/api/modules/auth.api'

export const useAuthStore = defineStore('auth', () => {

  // ─── State ────────────────────────────────────────────────

  /** 是否已通過認證；路由守衛、HTTP 攔截器的核心依賴 */
  const isAuthenticated = ref<boolean>(false)

  /** 當前登入用戶資料；null 表示尚未登入或未加載 */
  const user = ref<UserProfile | null>(null)

  /**
   * Access Token 內存副本（不持久化，持久化交給 OS 鑰匙串）。
   * 為何不存 localStorage：明文存儲容易被 XSS 或本機掃描工具竊取。
   * HTTP 攔截器讀此值寫入 Authorization header。
   */
  const accessToken = ref<string | null>(null)

  /** 會話恢復進行中：避免應用啟動瞬間出現「未登入」閃屏，路由守衛也會等它完成 */
  const isRestoringSession = ref<boolean>(false)

  // ─── Getters ──────────────────────────────────────────────

  /** 用戶顯示名（user 為 null 時返回空字串） */
  const displayName = computed(() => user.value?.name ?? '')

  /** 用戶頭像：後端暫無頭像字段，UI 以姓名首字取代顯示 */
  const avatarUrl = computed(() => '')

  // ─── Actions ──────────────────────────────────────────────

  /**
   * 從 OS 鑰匙串恢復登入態。
   * 用於：App.vue onMounted 啟動時呼叫一次。
   * 找到 token 即直接視為已登入，過期由後續 401 攔截器處理。
   */
  async function restoreSession(): Promise<void> {
    isRestoringSession.value = true
    try {
      const token = await window.electronAPI.auth.getToken()

      if (token) {
        accessToken.value = token
        isAuthenticated.value = true
        return
      }

      // 無 token：保持未登入，路由守衛會導向 /login
    } catch (err) {
      console.error('[AuthStore] 會話恢復失敗:', err)
    } finally {
      isRestoringSession.value = false
    }
  }

  /**
   * 登錄：呼叫後端、寫鑰匙串、更新內存狀態。
   * @param userName 工號（如 "S2403279"）
   * @param password 密碼
   * @throws 登錄失敗時拋出錯誤（由 LoginView 捕獲顯示給用戶）
   */
  async function login(userName: string, password: string): Promise<void> {
    // authApi 已剝掉外層 code/message，這裡直接拿 { token, user }
    const { token, user: userInfo } = await authApi.login({ username: userName, password }) as unknown as { token: string; user: UserProfile }

    // 持久化到 OS 鑰匙串（下次啟動可自動恢復）
    await window.electronAPI.auth.setToken(token)

    accessToken.value = token
    user.value = userInfo
    isAuthenticated.value = true
  }

  /**
   * 登出：刪除鑰匙串 token + 清空內存狀態。
   * 用於：登出按鈕、401 攔截器強制登出。
   * 鑰匙串刪除失敗仍要清內存，確保當前 session 立即終止。
   */
  async function logout(): Promise<void> {
    try {
      await window.electronAPI.auth.deleteToken()
    } catch (err) {
      console.warn('[AuthStore] 刪除 Token 失敗:', err)
    } finally {
      accessToken.value = null
      user.value = null
      isAuthenticated.value = false
    }
  }

  /**
   * 更新內存中的 token（不寫鑰匙串）。
   * 用於：HTTP 攔截器收到後端刷新的新 token 時。
   * 如需持久化請另外呼叫 window.electronAPI.auth.setToken。
   * @param token 新的 JWT Access Token
   */
  function setToken(token: string): void {
    accessToken.value = token
  }

  return {
    // State
    isAuthenticated,
    user,
    accessToken,
    isRestoringSession,
    // Getters
    displayName,
    avatarUrl,
    // Actions
    restoreSession,
    login,
    logout,
    setToken
  }
})
