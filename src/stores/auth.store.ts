/**
 * 認證 Store（Pinia）
 *
 * ── 什麼是 Pinia Store？ ────────────────────────────────────────────
 * Pinia 是 Vue 3 官方推薦的全局狀態管理庫（取代 Vuex）。
 * defineStore('auth', () => { ... }) 是「Setup Store」寫法：
 *   - 第一個參數 'auth' 是 Store 的唯一 ID，Pinia 用它在 DevTools 中標識
 *   - 第二個參數是一個 setup 函數，就像 Vue 3 的 <script setup>
 *   - 函數內用 ref/computed 聲明響應式狀態和計算屬性
 *   - 函數內用普通 function 聲明 action
 *   - return 的對象就是其他組件能訪問的 public API
 *
 * ── 如何在組件/路由守衛中使用？ ──────────────────────────────────────
 * import { useAuthStore } from '@/stores/auth.store'
 * const authStore = useAuthStore()      // 獲取 store 實例（單例）
 * authStore.isAuthenticated              // 讀取狀態
 * authStore.restoreSession()             // 調用 action
 *
 * ── 本 Store 的職責 ──────────────────────────────────────────────────
 * 管理用戶認證狀態：
 *  - Token 在 OS 鑰匙串中持久化（通過 IPC 讀寫，見 window.electronAPI.auth）
 *  - Token 的內存副本存在 accessToken ref 中，供 HTTP 攔截器讀取
 *  - isAuthenticated 控制路由守衛（router/index.ts beforeEach）
 *
 * ── 登錄功能當前為「預留狀態」 ─────────────────────────────────────
 *  - 所有接口已定義，業務邏輯標記為 TODO
 *  - restoreSession 已實現（讀取現有 token）
 *  - login / logout 接口已聲明，待後端接口確認後實現
 */

// ── import 說明 ──────────────────────────────────────────────────────
// defineStore：Pinia 庫提供的函數，用來創建一個全局狀態倉庫（Store）
//   來源：pinia 套件（安裝於 node_modules/pinia）
import { defineStore } from 'pinia'

// ref：Vue 3 響應式 API，用來創建一個「可追蹤變化」的變量
//   當 ref 的值改變時，所有讀取它的組件/計算屬性會自動重新渲染
// computed：Vue 3 響應式 API，用來創建一個「根據其他響應式數據自動計算」的唯讀值
//   來源：vue 套件（Vue 3 核心庫）
import { ref, computed } from 'vue'

// UserProfile：用戶信息的 TypeScript 類型定義（interface）
//   來源：@/types/api.types.ts（@ 是 src/ 目錄的別名，在 vite.config.ts 中配置）
//   import type 表示「只導入類型」，編譯後不會出現在 JS 代碼中，節省包大小
import type { UserProfile } from '@/types/api.types'
import { authApi } from '@/api/modules/auth.api'

// ── Store 定義 ────────────────────────────────────────────────────────
// useAuthStore 是導出的 composable 函數名，Vue 3 約定以 use 開頭
// 任何地方調用 useAuthStore() 都會得到同一個 Store 實例（Pinia 保證全局單例）
export const useAuthStore = defineStore('auth', () => {

  // ═══════════════════════════════════════════════════════════════════
  // State（狀態）
  // 用 ref() 包裹的變量就是響應式狀態。
  // 當它們的 .value 改變時，所有使用它們的地方（模板、computed、watch）
  // 都會自動更新，不需要手動通知。
  // ═══════════════════════════════════════════════════════════════════

  /**
   * 用戶是否已通過認證
   *
   * 用途（在哪裡讀取）：
   *  1. router/index.ts 的 beforeEach 守衛：
   *     未登錄時攔截需要認證的頁面，跳轉到 /login
   *  2. src/api/interceptors.ts（HTTP 攔截器）：
   *     發送請求前確認是否有有效登錄狀態
   *  3. 各個需要登錄的組件：用於控制 UI 顯示邏輯
   *
   * 初始值 false：應用啟動時默認未登錄，
   * restoreSession() 執行後若找到有效 Token 才設為 true
   */
  const isAuthenticated = ref<boolean>(false)

  /**
   * 當前登錄用戶的個人信息
   *
   * 類型 UserProfile | null：
   *  - UserProfile 是後端 API 返回的用戶資料結構
   *    （定義在 @/types/api.types.ts，包含 name、avatar、email 等字段）
   *  - null 表示「尚未獲取到用戶信息」（未登錄或登錄但未加載）
   *
   * 用途：
   *  - displayName computed 從這裡取 .name
   *  - avatarUrl computed 從這裡取 .avatar
   *  - 用戶個人信息展示組件（TitleBar、UserProfile 等）
   */
  const user = ref<UserProfile | null>(null)

  /**
   * Access Token（JWT，僅存在內存中，不持久化到磁盤）
   *
   * ── 為什麼只存內存，不存 localStorage / sessionStorage？ ────────
   * localStorage 是「明文存儲」，任何能在頁面執行的 JS 代碼都能讀取：
   *  - XSS 攻擊（惡意注入的 JS）可以竊取 Token
   *  - 在 Electron 中，由於是本地應用，還可能被磁盤文件掃描工具讀取
   *  - electron-store（Electron 專用持久化庫）同樣是明文寫磁盤，風險相同
   *
   * ── 正確做法：OS 鑰匙串（Keychain/Credential Store）───────────────
   * 主進程通過 keytar 庫（一個 Node.js 原生模塊）將 Token 存入系統鑰匙串：
   *  - macOS Keychain Access
   *  - Windows Credential Manager
   *  - Linux libsecret
   * 系統鑰匙串是加密存儲，只有具有相應權限的進程才能讀取。
   *
   * ── 渲染進程如何讀取 Token？ ────────────────────────────────────────
   * 渲染進程（Vue 代碼）通過 IPC 向主進程請求 Token：
   *   window.electronAPI.auth.getToken()  →  主進程從鑰匙串讀取  →  返回給渲染進程
   * 讀回後存到這個 ref，供 HTTP 攔截器在 Authorization header 中使用：
   *   `Authorization: ${accessToken.value}`（直接帶 token，不加 Bearer 前綴）
   *
   * 用途（在哪裡讀取）：
   *  - src/api/interceptors/auth.interceptor.ts：每次發 HTTP 請求前注入 Authorization header
   *  - setToken() action：HTTP 攔截器收到 Token 刷新響應時，更新這個值
   */
  const accessToken = ref<string | null>(null)

  /**
   * 會話恢復是否正在進行中
   *
   * 用途：
   *  - App.vue：在 restoreSession() 執行期間顯示加載動畫，防止用戶看到「閃屏」
   *    （如果沒有這個 flag，應用啟動瞬間會先顯示「未登錄」狀態，
   *     然後 Token 加載完成再跳轉，造成體驗不好的頁面抖動）
   *  - 路由守衛：等待 isRestoringSession 變為 false 後再判斷跳轉邏輯
   */
  const isRestoringSession = ref<boolean>(false)

  // ═══════════════════════════════════════════════════════════════════
  // Getters（計算屬性）
  // computed() 會自動追蹤依賴，當 user.value 改變時自動重新計算
  // 在 Pinia 中，computed 就是 Getter（相當於 Vuex 的 getters）
  // ═══════════════════════════════════════════════════════════════════

  /**
   * 用戶顯示名稱
   *
   * 語法說明：
   *  user.value?.name  → 可選鏈（Optional Chaining）
   *    user.value 如果是 null，不會報錯，直接返回 undefined
   *  ?? ''             → 空值合并運算符（Nullish Coalescing）
   *    如果左側是 null 或 undefined，就返回右側的空字符串 ''
   *
   * 用途：TitleBar.vue、頭像下方的用戶名文字等
   */
  const displayName = computed(() => user.value?.name ?? '')

  /**
   * 用戶頭像 URL
   * 邏輯同 displayName：user 為 null 時返回空字符串（UI 可顯示默認頭像佔位）
   *
   * 用途：TitleBar.vue、用戶信息彈窗等
   */
  /** 用戶頭像：後端暫無頭像字段，以姓名首字取代顯示 */
  const avatarUrl = computed(() => '')

  // ═══════════════════════════════════════════════════════════════════
  // Actions（方法/動作）
  // 在 Pinia Setup Store 中，普通函數就是 Action
  // Action 可以是同步的，也可以是 async（異步）的
  // ═══════════════════════════════════════════════════════════════════

  /**
   * 恢復會話（應用啟動時調用）
   *
   * ── 在哪裡調用？ ───────────────────────────────────────────────────
   * src/App.vue 的 onMounted 生命周期鉤子中：
   *   onMounted(async () => {
   *     await authStore.restoreSession()   // ← 這裡
   *     uiStore.hideGlobalLoading()
   *   })
   * onMounted 在組件掛載到 DOM 後執行，是應用的「啟動入口」之一。
   *
   * ── 執行流程 ────────────────────────────────────────────────────────
   * 1. 設置 isRestoringSession = true（顯示加載動畫）
   * 2. 調用 window.electronAPI.auth.getToken()
   *    → 通過 IPC 通道 → 主進程從 OS 鑰匙串讀取 Token
   * 3. 若 Token 存在：
   *    a. 將 Token 存到內存（accessToken.value）
   *    b. 設置 isAuthenticated = true（允許訪問受保護頁面）
   *    （注意：user 信息在此步驟無法恢復，只有 token。若需要，可在此調用 /user/profile）
   * 4. 無 Token 且開發環境開啟 AUTO_LOGIN → 自動登錄
   * 5. 無論成功失敗，最後都設置 isRestoringSession = false
   *
   * ── async/await 說明 ────────────────────────────────────────────────
   * async function 使函數返回 Promise
   * await 暫停函數執行，等待 Promise 完成，語法上讓異步代碼像同步一樣可讀
   *
   * ── try/catch/finally 說明 ──────────────────────────────────────────
   * try    ：嘗試執行的代碼塊（可能拋出錯誤的操作）
   * catch  ：捕獲錯誤，避免未處理的 Promise 報錯讓應用崩潰
   * finally：無論成功失敗都執行（這裡用來確保 isRestoringSession 一定被設回 false）
   */
  async function restoreSession(): Promise<void> {
    isRestoringSession.value = true
    try {
      // 1. 嘗試從 OS 鑰匙串恢復已有 Token
      const token = await window.electronAPI.auth.getToken()

      if (token) {
        // Token 存在，直接恢復會話（是否過期由後續 401 攔截器處理）
        accessToken.value = token
        isAuthenticated.value = true
        return
      }

      // 2. 無 Token：isAuthenticated 保持 false
      //    路由守衛會導向 /login，LoginView 掛載時會處理開發環境自動登錄
    } catch (err) {
      console.error('[AuthStore] 會話恢復失敗:', err)
    } finally {
      isRestoringSession.value = false
    }
  }

  /**
   * 登錄（預留接口，待實現）
   *
   * ── 參數說明 ────────────────────────────────────────────────────────
   * _username, _password：前綴下劃線 _ 是 TypeScript 約定，
   *   表示「此參數已聲明但暫未使用」，避免 TypeScript 編譯器報「unused variable」警告
   *
   * ── 實現步驟（TODO 取消注釋後的流程）──────────────────────────────
   *  1. 調用 POST /auth/login API，傳入 username/password
   *  2. 後端返回 { accessToken, user } 數據
   *  3. 通過 IPC 將 Token 存入 OS 鑰匙串（持久化，下次啟動可恢復）
   *  4. 更新內存中的 accessToken ref（當前 session 使用）
   *  5. 更新 user ref（顯示用戶頭像、名稱等）
   *  6. 設置 isAuthenticated = true（路由守衛放行）
   *  7. 在 LoginView.vue 中調用此 action 後 router.push('/unified-platform')
   *
   * ── 當前狀態 ────────────────────────────────────────────────────────
   * 直接 throw Error，所有調用者（LoginView 的提交按鈕）會收到錯誤，
   * 顯示「功能尚未實現」提示，不會讓用戶看到空白的假登錄效果
   */
  /**
   * 登錄
   * @param userName 工號（如 "S2403279"）
   * @param password 密碼
   * @throws 登錄失敗時拋出錯誤（由 LoginView 捕獲顯示給用戶）
   */
  async function login(userName: string, password: string): Promise<void> {
    // 1. 呼叫後端登錄接口
    //    攔截器已提取 response.data，authApi.login 再提取 .data 層，
    //    最終拿到的是 { token, user }，不含外層 code/message
    const { token, user: userInfo } = await authApi.login({ username: userName, password }) as unknown as { token: string; user: UserProfile }

    // 2. 將 Token 存入 OS 鑰匙串（持久化，下次啟動可自動恢復會話）
    await window.electronAPI.auth.setToken(token)

    // 3. 更新內存狀態（供 HTTP 攔截器和各組件使用）
    accessToken.value = token
    user.value = userInfo
    isAuthenticated.value = true
  }

  /**
   * 登出
   *
   * ── 執行流程 ────────────────────────────────────────────────────────
   * 1. 調用 window.electronAPI.auth.deleteToken()
   *    → IPC → 主進程從 OS 鑰匙串刪除 Token（下次啟動不會自動登錄）
   * 2. 無論刪除是否成功，都清除內存中的所有認證狀態
   *    （用 finally 保證一定執行）
   * 3. 路由守衛感知到 isAuthenticated = false，
   *    如果當前頁面需要認證則自動跳轉到 /login
   *
   * ── 為什麼 deleteToken 失敗也要繼續清除內存狀態？ ─────────────────
   * 用戶登出的核心目的是「在本設備上不再允許訪問」。
   * 即使鑰匙串刪除失敗（極少情況），也應該清除內存中的 Token，
   * 確保當次 session 安全終止。下次啟動時 restoreSession 可能再次
   * 讀到舊 Token，但這優先級低於「當前立即登出」。
   *
   * ── 在哪裡調用？ ───────────────────────────────────────────────────
   * - 用戶點擊「登出」按鈕的組件（TitleBar、UserMenu 等）
   * - 401 HTTP 攔截器中（Token 過期時強制登出）：
   *   if (response.status === 401) { authStore.logout() }
   */
  async function logout(): Promise<void> {
    try {
      // 從 OS 鑰匙串刪除 Token（持久化清除）
      // 此操作通過 IPC 由主進程執行，渲染進程無法直接訪問鑰匙串
      await window.electronAPI.auth.deleteToken()
    } catch (err) {
      // 記錄失敗但不讓錯誤阻止後續的內存清除
      console.warn('[AuthStore] 刪除 Token 失敗:', err)
    } finally {
      // 無論刪除是否成功，都清除內存狀態（確保當前 session 登出）
      accessToken.value = null       // 清除 Token 內存副本
      user.value = null              // 清除用戶信息
      isAuthenticated.value = false  // 觸發路由守衛，跳轉到登錄頁
    }
  }

  /**
   * 設置 Token（由外部調用以更新內存中的 Token）
   *
   * ── 在哪裡調用？ ───────────────────────────────────────────────────
   * src/api/interceptors.ts 中的 HTTP 響應攔截器：
   * 當後端返回刷新的 Token（如 Token 即將過期時後端自動刷新），
   * 攔截器從響應頭中取出新 Token，調用此方法更新內存副本：
   *   const newToken = response.headers['x-new-token']
   *   if (newToken) { authStore.setToken(newToken) }
   *
   * ── 注意 ────────────────────────────────────────────────────────────
   * 此方法只更新內存（accessToken ref），不寫入 OS 鑰匙串。
   * 如需持久化新 Token，調用者還需調用：
   *   window.electronAPI.auth.setToken(token)
   *
   * @param token 新的 JWT Access Token 字符串
   */
  function setToken(token: string): void {
    accessToken.value = token
  }

  // ── Store 的公開 API ──────────────────────────────────────────────
  // return 的對象決定了外部組件能訪問哪些狀態和方法
  // 沒有 return 的內部變量（如果有的話）不會暴露出去，類似類的私有成員
  return {
    // State（響應式狀態）：組件可以直接讀取，也可以通過 action 修改
    isAuthenticated,      // 是否已認證（路由守衛核心依賴）
    user,                 // 用戶信息對象（頭像、名稱等）
    accessToken,          // Token 內存副本（HTTP 攔截器讀取）
    isRestoringSession,   // 啟動加載 flag（App.vue 讀取）
    // Getters（計算屬性）：只讀，不能直接賦值
    displayName,          // 用戶名稱字符串（模板顯示）
    avatarUrl,            // 用戶頭像 URL（img src）
    // Actions（方法）：修改狀態的唯一入口
    restoreSession,       // App.vue onMounted 調用
    login,                // LoginView 提交按鈕調用
    logout,               // 登出按鈕 / 401 攔截器調用
    setToken              // HTTP 攔截器收到新 Token 時調用
  }
})
