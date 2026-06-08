/**
 * 認證狀態（token / user / isAuthenticated）。
 * 用於：路由守衛 router/index.ts、HTTP 攔截器、登錄登出組件。
 * Token 僅存在內存中（Pinia Store），退出應用後丟失，下次啟動需重新登錄。
 */

import {defineStore} from 'pinia'
import {computed, ref} from 'vue'
import type {UserProfile} from '@/types/api.types'
import {authApi} from '@/api/auth.api'
import {parseUserFromJwt} from '@/shared/utils/jwt'
import {logger} from '@/shared/utils/logger'

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

  /**
   * 本次 App 進程內是否禁用 AD 自動登入。
   *
   * 用途:使用者主動「登出」後設為 true,避免 App.vue 啟動鉤子 / 401 重試
   *      又把他自動登進去形成循環。完全關閉 App 重啟後此 flag 歸 false,
   *      下次啟動恢復 AD 自動登入能力。
   *
   * 不用 sessionStorage 是因為 Electron 主窗關掉重開不會清 sessionStorage,
   * 而我們希望 App 進程結束才重置。記憶體 flag 跟 token 一樣只活在當前進程內。
   */
  const adLoginDisabledThisSession = ref(false)

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
   * AD 自動登入。
   *
   * 流程:
   *  1. 透過 IPC 取本機 Windows 帳號名
   *  2. 帶帳號名打後端 ad-token 接口,拿到 JWT
   *  3. 解 JWT payload 拼出 UserProfile,寫入 store
   *
   * 任一步驟失敗(取不到帳號 / 接口失敗 / token 空 / JWT 無效)→ 返回 false,
   * 由呼叫方(App.vue / 401 攔截器)決定後續(降級 /login 或彈窗)。
   *
   * 不拋例外:這個方法天生就是「能成功最好,不能就走別路」,
   * 不該打擾上層流程控制。
   *
   * @returns true 成功並寫入 store;false 失敗。
   */
  async function loginByAd(): Promise<boolean> {
    // 1. 本次 session 內已被禁用(使用者剛登出)
    if (adLoginDisabledThisSession.value) {
      logger.debug('AD 自動登入本次 session 已被禁用,跳過', 'Auth')
      return false
    }

    // 2. 取 Windows 帳號
    let account = ''
    try {
      account = await window.electronAPI.auth.getAdAccount()
    } catch (err) {
      logger.warn('讀取本機 AD 帳號 IPC 失敗', 'Auth', err as Error)
      return false
    }
    if (!account) {
      logger.info('未取得本機 AD 帳號(非 Windows 或讀取失敗),跳過 AD 登入', 'Auth')
      return false
    }

    // 3. 呼叫後端換 token
    let token = ''
    try {
      token = await authApi.adLogin(account)
      // 走 logger 讓這條紀錄落入 SQLite logs 表(同時 DevTools console 仍可見)。
      // 不印完整 token,只印長度確認接口是否回傳有效字串,避免 token 落地敏感資訊。
      logger.debug(`AD 換 token 完成,長度=${token.length}`, 'Auth')
    } catch (err) {
      logger.warn(`AD 換 token 接口失敗,帳號=${account}`, 'Auth', err as Error)
      return false
    }
    if (!token) {
      logger.info(`AD 換 token 接口回傳空字串,帳號=${account}`, 'Auth')
      return false
    }

    // 4. 解 JWT
    const profile = parseUserFromJwt(token)
    if (!profile) {
      logger.warn('AD token JWT 解析失敗', 'Auth')
      return false
    }

    // 5. 寫入 store
    accessToken.value = token
    user.value = profile
    isAuthenticated.value = true
    logger.info(`AD 自動登入成功,使用者=${profile.userName}`, 'Auth')
    return true
  }

  /**
   * 用記住的密碼自動登入。
   *
   * 流程:
   *  1. 從本機 SQLite 讀已記住的憑證
   *  2. 拿憑證走標準 authApi.login(同表單登入流程,完全等價)
   *
   * 對齊 loginByAd 的設計:不拋例外,失敗回 false 讓上層決定降級。
   * 失敗會自動清掉憑證(避免下次又拿過期密碼徒勞嘗試)。
   *
   * @returns true 成功並寫入 store;false 沒憑證 / 登入失敗。
   */
  async function loginBySaved(): Promise<boolean> {
      let entry: Awaited<ReturnType<typeof window.electronAPI.savedCredentials.get>>
      try {
          entry = await window.electronAPI.savedCredentials.get()
      } catch (err) {
          logger.warn('讀取已記住的憑證 IPC 失敗', 'Auth', err as Error)
          return false
      }
      if (!entry) return false

      try {
          const {token, user: userInfo} = await authApi.login({
              username: entry.userId,
              password: entry.password,
          })
          accessToken.value = token
          user.value = userInfo
          isAuthenticated.value = true
          logger.info(`記住密碼自動登入成功,使用者=${entry.userId}`, 'Auth')
          return true
      } catch (err) {
          // 密碼可能被後端改了 / 帳號鎖了 — 清掉憑證,讓使用者下次手動重來
          logger.warn(`記住密碼自動登入失敗,清除憑證,使用者=${entry.userId}`, 'Auth', err as Error)
          await window.electronAPI.savedCredentials.clear().catch(() => undefined)
          return false
      }
  }

    /**
     * 登出：清空所有內存狀態 + 清除已記住的密碼。
   * 用於：登出按鈕、401 攔截器強制登出。
   *
   * 設置 adLoginDisabledThisSession 防止 401 攔截器 / App.vue 又自動 AD 登入,
   * 形成「登出 → 自動登入 → 又看到自己登入了」的鬼打牆。
   * 完全關閉 App 重啟後該 flag 復原,使用者下次開啟仍享受 AD 自動登入。
     *
     * 已記住的密碼也一併清掉(對齊使用者預期:登出 = 我不要這台機器自動進去了)。
   */
  async function logout(): Promise<void> {
    accessToken.value = null
    user.value = null
    isAuthenticated.value = false
    adLoginDisabledThisSession.value = true
        // 清除本機憑證 — IPC 失敗不擴散,登出狀態本身仍然完成
        await window.electronAPI.savedCredentials.clear().catch((err) => {
            logger.warn('登出時清除已記住密碼失敗', 'Auth', err as Error)
        })
  }

  return {
    // State
    isAuthenticated,
    user,
    accessToken,
    adLoginDisabledThisSession,
    // Getters
    displayName,
    // Actions
    login,
    loginByAd,
      loginBySaved,
    logout
  }
})
