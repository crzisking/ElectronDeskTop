/**
 * Axios HTTP 客戶端工廠
 *
 * 使用工廠模式創建 Axios 實例，支持不同模塊使用不同 baseURL：
 *  - AI 功能 API：https://ai-api.company.internal/v1
 *  - 通用業務 API：https://api.company.internal/v1
 *
 * 每個創建的實例都會自動附加：
 *  - Auth 攔截器（注入 Bearer Token）
 *  - 錯誤攔截器（標準化 ApiError）
 *
 * ── 「調後端」傳輸策略(全專案兩條通道,別再各自發明第三種)──────────
 *  1. **渲染端 axios 直連(本檔,主要方向)**:一般業務 feature 用這個 —— repair / ai-sop /
 *     idea-capture 想法庫 / work-collect 等。走本工廠拿 client,攔截器注入 token、拆 envelope。
 *  2. **主進程 fetch(electron/main/services/http/main-http.ts)**:需要主進程上下文的才走 ——
 *     auth(避開 CORS)、跨窗共享的 project-flow / idea-capture create·refine、背景佇列 / 長任務。
 *     渲染端經 IPC 呼叫,token/baseUrl 由 main 統一注入。
 *  新功能預設走通道 1(渲染端 axios);只有「非主進程做不可」的才放通道 2。
 *
 * (舊註解「主進程不做任何 HTTP」是錯的 —— 主進程確實會發,見 main-http.ts。)
 *
 * ── 攔截器返回值約定 ────────────────────────────────────────────────
 * auth.interceptor 的響應攔截器會剝掉外層 { code, message, data }，
 * 直接返回 data（業務數據）。因此 API 模塊調用 client.post<T>() 時，
 * T 應該是業務數據的類型（而非包含 code/message 的外層類型），
 * 返回值直接就是 T 類型，不需要額外解構 { data }。
 */

import type {AxiosInstance, AxiosRequestConfig} from 'axios'
import axios from 'axios'
import {ElMessage, ElMessageBox} from 'element-plus'
import {type InterceptorUiHooks, setupAuthInterceptor} from './interceptors/auth.interceptor'

/**
 * 主窗的 UI 注入實作 — 走 Element Plus。
 *
 * 攔截器本身不依賴 Element Plus(§1.8 解耦),所以注入點在這裡。
 * 其它窗口若要復用此 http-client 工廠,可以傳入自己的 hooks(目前主窗外的窗口都不直連後端,
 * 暫時沒有第二個實作)。
 */
const elementPlusUiHooks: InterceptorUiHooks = {
    showError(message) {
        ElMessage.error(message)
    },
    showAlert(message, title, confirmText) {
        return ElMessageBox.alert(message, title, {confirmButtonText: confirmText}).then(() => undefined)
    },
}

/**
 * 從 Vite 環境變量讀取 API 配置
 * .env.development → npm run dev 時生效
 * .env.production  → npm run build 時生效
 */
export const ENV = {
  /** 通用業務 API 基礎地址 */
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8080/api/v1',
  /** 登錄/認證 API 基礎地址 */
  authBaseUrl: import.meta.env.VITE_AUTH_BASE_URL ?? 'http://localhost:8080/auth',
  /** 請求超時（ms） */
  apiTimeout: Number(import.meta.env.VITE_API_TIMEOUT ?? 30000),
}

/**
 * 類型安全的 API 客戶端接口。
 *
 * 攔截器已剝掉 { code, message, data } 外層，直接返回 data（業務數據），
 * 所以 post<T>() / get<T>() 的返回值就是 T 類型，而非 AxiosResponse<T>。
 * 這個接口讓 TypeScript 正確推斷返回類型，避免 API 模塊到處加 as 斷言。
 */
export interface ApiClient {
    get<T = unknown>(url: string, config?: AxiosRequestConfig): Promise<T>

    post<T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T>

    put<T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T>

    patch<T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T>

    delete<T = unknown>(url: string, config?: AxiosRequestConfig): Promise<T>
}

/**
 * 創建帶有完整攔截器的 API 客戶端。
 *
 * 攔截器會剝掉後端返回的 { code, message, data } 外層，直接返回 data（業務數據），
 * 因此返回的 ApiClient 的泛型 T 直接對應業務數據類型。
 *
 * @param baseURL  API 根地址（如 https://api.company.internal/v1）
 * @param timeout  請求超時毫秒數（默認 15000ms）
 * @returns 類型安全的 ApiClient 實例
 *
 * @example
 * const client = createHttpClient('https://api.company.internal/v1')
 * // result 的類型直接是 UserProfile，不需要解構 { data }
 * const result = await client.get<UserProfile>('/user/profile')
 */
export function createHttpClient(baseURL: string, timeout = 15000): ApiClient {
    const instance: AxiosInstance = axios.create({
    baseURL,
    timeout,
    headers: {
      // 告知後端這是 Electron 桌面端請求，便於後端日誌區分
      'X-Client-Type': 'electron-desktop'
    }
  })

    // 附加完整攔截器(Token 注入 + 業務碼 / HTTP 錯誤 / 401 過期 統一處理)
    // UI 行為走 Element Plus(§1.8 解耦後,攔截器自身不再依賴 Element Plus)
    setupAuthInterceptor(instance, elementPlusUiHooks)

    // axios 方法的完整泛型簽名是 <T, R = AxiosResponse<T>, D = any>,預設 R = AxiosResponse<T>。
    // 我們的攔截器已剝掉外層只返 data,實際 runtime 行為就是 R = T。
    // 把 R 顯式指定為 T,TypeScript 自然推導出 Promise<T>,不需 `as unknown as Promise<T>` 雙重 cast,
    // 也讓編譯期型別跟 runtime 對齊(以前 cast 是把錯誤型別硬鋸成對,使用方拿到的 .data / .headers 等都會誤導 IDE)。
    return {
        get: <T = unknown>(url: string, config?: AxiosRequestConfig) =>
            instance.get<T, T>(url, config),
        post: <T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig) =>
            instance.post<T, T>(url, data, config),
        put: <T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig) =>
            instance.put<T, T>(url, data, config),
        patch: <T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig) =>
            instance.patch<T, T>(url, data, config),
        delete: <T = unknown>(url: string, config?: AxiosRequestConfig) =>
            instance.delete<T, T>(url, config),
    }
}

// ── 記憶化工廠 ────────────────────────────────────────────────
// 取代各 feature 自寫的 `let _client=null; function getClient(){…}` 樣板(曾在 4 個 api.ts 各一份)。
const _clientCache = new Map<string, ApiClient>()

/**
 * 依 baseURL(+timeout)記憶化的 ApiClient。同參數只建一次、跨 feature 共用。
 * @example const client = httpClientFor(BACKEND_BASE_URL)
 */
export function httpClientFor(baseURL: string, timeout = 15000): ApiClient {
    const key = `${baseURL}|${timeout}`
    let client = _clientCache.get(key)
    if (!client) {
        client = createHttpClient(baseURL, timeout)
        _clientCache.set(key, client)
    }
    return client
}
