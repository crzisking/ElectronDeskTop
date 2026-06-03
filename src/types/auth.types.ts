/**
 * Auth / 用戶身份相關類型
 *
 * 使用方：
 *  - src/api/auth.api.ts
 *  - src/stores/auth.store.ts
 *  - src/api/interceptors/auth.interceptor.ts
 */

// ─── 統一 API 錯誤類型 ────────────────────────────────────────────────
/**
 * 所有 API 錯誤都被 auth.interceptor.ts 攔截並標準化為此類型。
 * 組件層只需 catch ApiError，無需了解 Axios 底層結構。
 */
export interface ApiError {
  /** 業務錯誤碼，如 "USER_NOT_FOUND"、"TOKEN_EXPIRED" */
  code: string
  /** 用戶可讀的錯誤描述 */
  message: string
  /** HTTP 狀態碼（網絡層錯誤時為 0） */
  statusCode: number
  /** 後端返回的額外錯誤詳情（可選） */
  details?: unknown
}

// ─── 登錄相關 ─────────────────────────────────────────────────────────

/**
 * 登錄請求體
 * POST /api/portal/oauth/login
 */
export interface LoginCredentials {
  /** 工號（如 "S2403279"） */
  username: string
  /** 密碼 */
  password: string
}

/**
 * 後端登錄接口原始響應
 * { "code": 200, "message": "登录成功。", "data": { "user": {...}, "token": "eyJ..." } }
 */
export interface LoginResponse {
  code: number
  message: string
  data: {
    user: UserProfile
    token: string
  }
}

/**
 * 用戶個人信息
 * 對應後端 /api/portal/oauth/login 返回的 data.user 字段
 */
export interface UserProfile {
  /** 用戶數據庫 ID */
  id: number
  /** 工號（如 "S2403279"） */
  userName: string
  /** 顯示姓名（如 "陳閏知"） */
  name: string
  /** 是否主帳號 */
  primary: boolean
  /** 語言偏好（如 "zh_CN"） */
  lang: string
  /** 可訪問廠別代碼（逗號分隔字符串，如 "3200,3100"） */
  fcty: string
  /** 可訪問廠別代碼列表 */
  fctyList: string[]
  /** 帳號是否啟用 */
  enabled: boolean
  /** 部門編號（如 "10040300"） */
  deptNo: string
  /** 手機號碼 */
  phoneNo: string
  /** 電子郵件 */
  email: string
  /** 性別（true = 男） */
  gender: boolean
  /** 性別描述（如 "男/Male"） */
  genderLabel: string
}
