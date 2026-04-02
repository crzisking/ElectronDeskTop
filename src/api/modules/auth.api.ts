/**
 * Auth API 模塊（預留）
 *
 * 登錄、登出、Token 刷新等接口。
 * 當前為預留占位，業務邏輯標記為 TODO。
 *
 * 注意：Token 存取使用 IPC（OS 鑰匙串），不走此 HTTP 模塊。
 * 此模塊只負責與後端的 Auth 業務接口通信。
 */

import { createHttpClient } from '../http-client'
import { useConfigStore } from '@/stores/config.store'
import type { LoginCredentials, LoginResponse } from '@/types/api.types'

/**
 * Auth API Composable
 *
 * 使用 Composable 函數風格，確保 configStore 已加載後再創建 client。
 * 在 authStore.login() 中調用此函數。
 */
export function useAuthApi() {
  // 從 configStore 獲取 API 基礎地址
  // TODO: 配置文件中加入 authApiBaseUrl 字段後從此讀取
  const BASE_URL = 'https://api.company.internal/v1'
  const client = createHttpClient(BASE_URL)

  return {
    /**
     * 用戶登錄
     * POST /auth/login
     * @param credentials 用戶名+密碼
     * @returns Token 和用戶信息
     *
     * TODO: 登錄功能實現時取消注釋
     */
    async login(credentials: LoginCredentials): Promise<LoginResponse> {
      const { data } = await client.post<LoginResponse>('/auth/login', credentials)
      return data
    },

    /**
     * 驗證 Token 是否有效
     * GET /auth/verify
     * @returns 是否有效
     *
     * TODO: 用於應用啟動時驗證已保存的 Token
     */
    async verifyToken(): Promise<boolean> {
      try {
        await client.get('/auth/verify')
        return true
      } catch {
        return false
      }
    },

    /**
     * 獲取當前用戶信息
     * GET /auth/profile
     *
     * TODO: 登錄後調用此接口填充 authStore.user
     */
    async getProfile() {
      const { data } = await client.get('/auth/profile')
      return data
    }
  }
}

// 避免 configStore 未使用的 lint 警告
void useConfigStore
