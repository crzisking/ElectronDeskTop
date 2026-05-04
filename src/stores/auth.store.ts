/**
 * 認證狀態（token / user / isAuthenticated）。
 * 用於：路由守衛 router/index.ts、HTTP 攔截器、登錄登出組件。
 * Token 僅存在內存中（Pinia Store），退出應用後丟失，下次啟動需重新登錄。
 */

import {defineStore} from 'pinia'
import {computed, ref} from 'vue'
import type {UserProfile} from '@/types/api.types'
import {authApi} from '@/api/modules/auth.api'

export const useAuthStore = defineStore('auth', () => {

  // ─── State ────────────────────────────────────────────────

  /** 是否已通過認證；路由守衛、HTTP 攔截器的核心依賴 */
  const isAuthenticated = ref<boolean>(false)

  /** 當前登入用戶資料；null 表示尚未登入或未加載 */
  const user = ref<UserProfile | null>(null)

  /**
   * Access Token（僅內存，不持久化到本地磁盤）。
   * HTTP 攔截器讀此值寫入 Authorization header。
   */
  const accessToken = ref<string | null>(null)

  /** 會話恢復標記（已棄用，保留兼容性） */
  const isRestoringSession = ref(false)

  // ─── Getters ──────────────────────────────────────────────

  /** 用戶顯示名（user 為 null 時返回空字串） */
  const displayName = computed(() => user.value?.name ?? '')

  // ─── Actions ──────────────────────────────────────────────

  /**
   * 登錄：呼叫後端、更新內存狀態（不持久化 token）。
   * @param userName 工號（如 "S2403279"）
   * @param password 密碼
   * @throws 登錄失敗時拋出錯誤（由 LoginView 捕獲顯示給用戶）
   */
  async function login(userName: string, password: string): Promise<void> {
    const {token, user: userInfo} = await authApi.login({username: userName, password})

    accessToken.value = token
    user.value = userInfo
    isAuthenticated.value = true
  }

  /**
   * 登出：清空所有內存狀態。
   * 用於：登出按鈕、401 攔截器強制登出。
   */
  async function logout(): Promise<void> {
      accessToken.value = null
      user.value = null
      isAuthenticated.value = false
  }

  return {
    // State
    isAuthenticated,
    user,
    accessToken,
    isRestoringSession,
    // Getters
    displayName,
    // Actions
    login,
    logout
  }
})
