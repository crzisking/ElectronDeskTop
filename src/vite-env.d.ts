/// <reference types="vite/client" />

/**
 * Vite 環境變量類型聲明
 *
 * 在這裡聲明的變量必須在 .env.development / .env.production 中定義，
 * 否則運行時值為 undefined（TypeScript 此處標記為可選 `?`）。
 *
 * 規則：
 *  - VITE_ 前綴 → 渲染進程可用（import.meta.env.VITE_XXX）
 *  - 無前綴     → 僅 Node/主進程可用，渲染進程無法訪問
 */
interface ImportMetaEnv {
  /** 通用業務 API 基礎地址（如 http://192.168.120.71:9222/api/v1） */
  readonly VITE_API_BASE_URL?: string
  /** Auth 服務宿主地址（如 http://192.168.120.71:9222） */
  readonly VITE_AUTH_BASE_URL?: string
  /** API 請求超時毫秒數（默認 30000） */
  readonly VITE_API_TIMEOUT?: string
  /** 開發環境自動登錄開關（'true' 時啟用） */
  readonly VITE_DEV_AUTO_LOGIN?: string
  /** 開發環境自動登錄工號 */
  readonly VITE_DEV_USERNAME?: string
  /** 開發環境自動登錄密碼 */
  readonly VITE_DEV_PASSWORD?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
