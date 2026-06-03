/**
 * 使用者身份同步 Pinia store。
 *
 * 對外 API:
 *  - syncAfterLogin() :登入後呼叫,偵測 AD 帳號變更 + 同步 dingId / unionId
 *  - profile / state  :reactive,供其他 feature 讀取
 *  - isReady          :computed,需要 dingId 的 feature 判斷此 flag 才能用
 *
 * 失敗策略(對齊 docs/12 §5.3):
 *   不對 caller 拋例外 —— LoginView / auth.store 呼叫此 store 不需 try/catch。
 *   錯誤寫進 profileError,UI 自行讀取顯示。
 */

import {defineStore} from 'pinia'
import {computed, ref} from 'vue'
import {useAuthStore} from '@/stores/auth.store'
import {logger} from '@/shared/utils/logger'
import {userProfileApi} from './api'
import type {DingUserResponse, ProfileState, UserProfile, UserProfileUpsertInput} from './types'

export const useUserProfileStore = defineStore('userProfile', () => {
  /** 當前 active profile;沒同步過或被清空時為 null */
  const profile = ref<UserProfile | null>(null)

  /** 同步狀態。idle:未呼叫過;syncing:進行中;ready:可用;syncError:失敗 */
  const profileState = ref<ProfileState>('idle')

  /** 同步失敗時的錯誤訊息,UI 顯示用 */
  const profileError = ref<string | null>(null)

  /** 其他 feature 判斷「能不能拿 dingId 用」 */
  const isReady = computed(() => profileState.value === 'ready' && profile.value !== null)

  /**
   * 登入成功後呼叫(LoginView / auth.store.loginByAd 內)。
   *
   * 流程:
   *   1. 從 authStore.user 拿當前 JWT 工號
   *   2. 跟 DB 內既有 active row 比對
   *      ├─ 不一致 → AD 帳號變更,IPC 跨表清空 user_profiles + work_records
   *      └─ 一致 + 非 forceRefresh → 直接沿用既有資料,不打後端
   *   3. 走後端拉最新(失敗則 profileState = syncError)
   *   4. IPC 寫回本機 DB
   *
   * @param forceRefresh true 時即使工號一致也強制打後端重抓(例:UI 手動「同步身份」按鈕)
   */
  async function syncAfterLogin(forceRefresh = false): Promise<void> {
    profileState.value = 'syncing'
    profileError.value = null

    try {
      const authStore = useAuthStore()
      const currentUserId = authStore.user?.userName
      if (!currentUserId) {
        profileState.value = 'syncError'
        profileError.value = '無法取得當前登入工號(JWT 缺 userName)'
        return
      }

      // 1. 比對既有 row
      const existing = await window.electronAPI.userProfile.getActive()

      // 2. 帳號變更偵測
      if (existing && existing.userId !== currentUserId) {
        const cleared = await window.electronAPI.userProfile.accountChangedClear({
          oldUserId: existing.userId,
          newUserId: currentUserId,
        })
        if (!cleared) {
          // cleanup 失敗就 abort,避免新舊資料混在一起
          profileState.value = 'syncError'
          profileError.value = '帳號變更清空舊資料失敗,請聯絡管理員'
          return
        }
        logger.info(
          `AD 帳號變更:${existing.userId} → ${currentUserId},舊資料已清空`,
          'UserProfileStore'
        )
      }

      // 3. 已有資料 + 工號一致 + 不強制刷新 → 沿用
      if (existing && existing.userId === currentUserId && !forceRefresh) {
        profile.value = existing
        profileState.value = 'ready'
        return
      }

      // 4. 打後端拉最新
      const fresh: DingUserResponse = await userProfileApi.getDingUserInfo()

      // 二次校驗:後端回的 jobNumber 必須跟當前 JWT 工號一致,防接口錯接 / 後端 bug
      if (fresh.jobNumber && fresh.jobNumber !== currentUserId) {
        profileState.value = 'syncError'
        profileError.value = `後端回傳工號 ${fresh.jobNumber} 與當前登入 ${currentUserId} 不一致`
        return
      }

      // 5. 寫進本機 DB
      const upsertPayload: UserProfileUpsertInput = {
        userId: currentUserId,
        dingId: fresh.userId,        // 釘釘 API 的 userId 就是 dingId
        unionId: fresh.unionId,
        displayName: fresh.name || null,
        email: null,                  // 釘釘 user.get 不直接給 email,留空
      }
      const ok = await window.electronAPI.userProfile.upsert(upsertPayload)
      if (!ok) {
        profileState.value = 'syncError'
        profileError.value = '寫入本機 user_profiles 失敗'
        return
      }

      // 6. 直接用手上的 fresh data 組 profile,**不再 IPC 讀回 DB**。
      //    舊版會 getActive() 再讀一次,理論上應該拿到剛 upsert 的 row,
      //    但若 DB 異常仍可能回 null,造成 profileState='ready' + profile=null 的不一致狀態。
      //    現在用已知非空的資料直接組,順便省一次 IPC round trip。
      profile.value = {
        userId: currentUserId,
        dingId: fresh.userId,
        unionId: fresh.unionId,
        displayName: fresh.name || null,
        email: null,
        syncedAt: Date.now(),
      }
      profileState.value = 'ready'
    } catch (err) {
      // axios 攔截器 throw 的 unified response Fail / 網路錯誤都會走到這
      const msg = err instanceof Error ? err.message : String(err)
      profileState.value = 'syncError'
      profileError.value = msg
      logger.warn('使用者身份同步失敗', 'UserProfileStore', err)
    }
  }

  return {
    profile,
    profileState,
    profileError,
    isReady,
    syncAfterLogin,
  }
})
