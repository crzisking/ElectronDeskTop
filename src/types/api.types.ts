/**
 * API 請求 / 響應類型定義
 *
 * 包含：
 *  - 統一 API 錯誤類型 ApiError
 *  - Auth 相關類型
 *  - AI 功能相關類型
 *  - 業務安排與尋找相關類型
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

// ─── 業務安排與尋找相關類型 ──────────────────────────────────────────

/**
 * X6 流程圖節點數據
 *
 * 對應 @antv/x6 的 Node.Metadata，用於序列化/反序列化流程圖。
 * 保存到後端時，整個流程圖被拆分為 nodes[] + edges[] 兩個數組。
 */
export interface FlowNode {
  /** 節點唯一 ID（X6 自動生成或手動指定） */
  id: string
  /** 節點在畫布上的 X 座標 */
  x: number
  /** 節點在畫布上的 Y 座標 */
  y: number
  /** 節點寬度 */
  width: number
  /** 節點高度 */
  height: number
  /** 節點形狀（rect=矩形, circle=圓形, ellipse=橢圓, polygon=多邊形等） */
  shape: string
  /** 節點顯示文字 */
  label: string
  /**
   * 節點自定義業務數據（可擴展）
   * 用於存儲與業務相關的額外信息，例如：
   *  - owner: 負責人
   *  - status: 節點狀態（待處理/進行中/已完成）
   *  - description: 詳細描述
   */
  data?: Record<string, unknown>
}

/**
 * X6 流程圖邊（連線）數據
 *
 * 對應 @antv/x6 的 Edge.Metadata，描述兩個節點之間的連線關係。
 */
export interface FlowEdge {
  /** 邊唯一 ID */
  id: string
  /** 來源節點 ID */
  source: string
  /** 目標節點 ID */
  target: string
  /** 邊上的文字標籤（可選，例如：「審批通過」「審批駁回」） */
  label?: string
  /** 邊的自定義業務數據（可擴展） */
  data?: Record<string, unknown>
}

/**
 * 業務流水線實體
 *
 * 一條流水線包含基本信息和完整的流程圖數據（nodes + edges）。
 * 前端使用 X6 渲染流程圖，保存時將圖數據序列化為此結構傳給後端。
 */
export interface Pipeline {
  /** 流水線唯一 ID（後端生成） */
  id: string
  /** 流水線名稱 */
  name: string
  /** 流水線描述（可選） */
  description?: string
  /** 流程圖節點數組 */
  nodes: FlowNode[]
  /** 流程圖連線數組 */
  edges: FlowEdge[]
  /** 創建時間（ISO 8601） */
  createdAt: string
  /** 最後更新時間（ISO 8601） */
  updatedAt: string
}

/**
 * 獲取流水線列表響應
 * GET {pipelineApiEndpoint}
 */
export interface PipelineListResponse {
  pipelines: Pipeline[]
  total: number
}

/**
 * 創建/更新流水線請求體
 * POST / PUT {pipelineApiEndpoint}
 */
export interface SavePipelineRequest {
  /** 流水線名稱 */
  name: string
  /** 流水線描述（可選） */
  description?: string
  /** 流程圖節點數組（X6 圖的序列化數據） */
  nodes: FlowNode[]
  /** 流程圖連線數組（X6 圖的序列化數據） */
  edges: FlowEdge[]
}

/**
 * 業務負責人（搜索結果項）
 *
 * 與原 Contact 類似，但聚焦在業務職責信息上。
 */
export interface BusinessOwner {
  /** 唯一 ID */
  id: string
  /** 姓名 */
  name: string
  /** 工作郵箱 */
  email: string
  /** 所屬部門 */
  department: string
  /** 職位 */
  title?: string
  /**
   * 負責的業務範圍列表
   * 示例：["採購審批", "供應商管理", "合同簽署"]
   */
  responsibilities: string[]
  /** 聯繫電話（可選） */
  phone?: string
  /** 頭像 URL（可選） */
  avatar?: string
}

/**
 * 業務負責人搜索響應
 * GET {ownerSearchApiEndpoint}?q={keyword}
 */
export interface BusinessOwnerSearchResponse {
  owners: BusinessOwner[]
  total: number
}
