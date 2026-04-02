/**
 * API 請求 / 響應類型定義
 *
 * 包含：
 *  - 統一 API 錯誤類型 ApiError
 *  - Auth 相關類型
 *  - AI 功能相關類型
 *  - 快速聯繫相關類型
 */

// ─── 統一錯誤類型 ────────────────────────────────────────────────
/**
 * 所有 API 錯誤都被 error.interceptor.ts 標準化為此格式，
 * 組件層只需處理 ApiError，無需了解 Axios 底層結構。
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

// ─── Auth 相關類型 ────────────────────────────────────────────────
/** 登錄請求體（預留，登錄功能待實現） */
export interface LoginCredentials {
  /** 用戶名或郵箱 */
  username: string
  /** 密碼（明文，HTTPS 傳輸） */
  password: string
}

/** 登錄成功響應體 */
export interface LoginResponse {
  /** JWT Access Token */
  accessToken: string
  /** Token 過期時間（ISO 8601 字符串） */
  expiresAt: string
  /** 用戶基本信息 */
  user: UserProfile
}

/** 用戶個人信息 */
export interface UserProfile {
  id: string
  name: string
  email: string
  /** 部門名稱 */
  department?: string
  /** 頭像 URL */
  avatar?: string
  /** 職位 */
  title?: string
}

// ─── AI 快捷功能相關類型 ─────────────────────────────────────────
/**
 * 文本處理請求
 * POST {aiBaseUrl}/text-process
 */
export interface TextProcessRequest {
  /** 待處理的原始文本 */
  text: string
  /**
   * 操作類型
   * - 'polish'    ：潤色（語法、用詞優化）
   * - 'translate' ：翻譯（配合 language 字段）
   * - 'format'    ：格式化（Markdown/JSON 等）
   */
  operation: 'polish' | 'translate' | 'format'
  /** 目標語言（translate 操作時必填） */
  language?: 'zh-TW' | 'zh-CN' | 'en' | 'ja'
}

/**
 * 摘要生成請求
 * POST {aiBaseUrl}/summarize
 */
export interface SummarizeRequest {
  /** 待摘要的長文本 */
  text: string
  /** 摘要最大字符數（可選，後端有默認值） */
  maxLength?: number
}

/**
 * 問答請求
 * POST {aiBaseUrl}/qa（支持 SSE 流式響應）
 */
export interface QaRequest {
  /** 當前問題 */
  question: string
  /** 補充上下文（可選） */
  context?: string
  /** 對話歷史（多輪對話時傳入） */
  history?: Array<{
    role: 'user' | 'assistant'
    content: string
  }>
}

/**
 * AI 功能通用非流式響應
 * 文本處理和摘要使用此格式
 */
export interface AiResponse {
  /** AI 返回的結果文本 */
  result: string
  /** Token 消耗統計 */
  usage: {
    inputTokens: number
    outputTokens: number
  }
}

// ─── 快速聯繫相關類型 ────────────────────────────────────────────
/** 聯繫人搜索結果項 */
export interface Contact {
  id: string
  /** 姓名 */
  name: string
  /** 工作郵箱 */
  email: string
  /** 部門 */
  department: string
  /**
   * 負責範圍描述列表
   * 用於向用戶說明"這個人負責什麼"
   * 示例：["網絡故障", "服務器運維", "IT 設備申請"]
   */
  responsibilities: string[]
  /** 頭像 URL（可選） */
  avatar?: string
  /** 聯繫電話（可選） */
  phone?: string
}

/**
 * 聯繫人搜索響應
 * GET {searchApiEndpoint}?q={keyword}
 */
export interface SearchContactsResponse {
  contacts: Contact[]
  total: number
}

/**
 * 發送郵件請求體
 * POST {emailApiEndpoint}
 */
export interface SendEmailRequest {
  /** 收件人郵箱 */
  to: string
  /** 收件人顯示名稱 */
  toName: string
  /** 郵件主題 */
  subject: string
  /** 郵件正文（純文本） */
  body: string
}

/** 發送郵件響應 */
export interface SendEmailResponse {
  /** 發送成功標誌 */
  success: boolean
  /** 郵件服務商返回的消息 ID（可用於追蹤） */
  messageId?: string
}
