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

// ── 流程節點類型枚舉 ────────────────────────────────────────────────
/**
 * 項目流程中的節點類型
 *
 * 不同類型對應不同的視覺樣式和業務含義：
 *  - start    ：流程起點（綠色圓角，每個流程只有一個）
 *  - end      ：流程終點（紅色圓角，可以有多個，代表不同結束方式）
 *  - task     ：任務節點（藍色，具體的工作項，例如「編寫需求文檔」）
 *  - approval ：審批節點（橙色，需要某人審批通過才能繼續）
 *  - condition：條件分支（菱形，根據條件走不同路徑，例如「金額 > 10萬？」）
 */
export type FlowNodeType = 'start' | 'end' | 'task' | 'approval' | 'condition'

/**
 * 流程節點業務數據
 *
 * 這些字段存儲在 Vue Flow 的 node.data 中，
 * 由自定義節點組件讀取並渲染為卡片內容。
 *
 * ── 設計說明 ────────────────────────────────────────────────────────
 * 此流程圖用於 **靜態業務流程留存**，存入資料庫供日後查詢負責人。
 * 不是動態狀態追蹤，因此沒有 status / estimatedDays 等動態欄位。
 * 每個節點記錄該步驟的負責人資訊（工號、姓名、部門代碼），
 * 方便後續根據流程圖查找對應負責人。
 */
export interface FlowNodeData {
  /** 節點顯示標題（簡短描述此步驟做什麼） */
  label: string

  /**
   * 節點類型（決定視覺樣式和業務含義）
   * 對應 FlowNodeType 枚舉
   */
  nodeType: FlowNodeType

  /** 負責人工號（例如：'A12345'） */
  employeeId?: string

  /** 負責人姓名 */
  employeeName?: string

  /** 部門代碼（例如：'IT-001'、'HR-002'） */
  departmentCode?: string

  /** 詳細描述（此步驟的具體內容、注意事項等） */
  description?: string
}

/**
 * 流程圖邊業務數據
 *
 * 存儲在 Vue Flow 的 edge.data 中，描述連線的業務含義。
 */
export interface FlowEdgeData {
  /** 邊上的文字標籤（例如：「審批通過」「審批駁回」「條件成立」） */
  label?: string
}

/**
 * 業務流水線實體
 *
 * 一條流水線包含基本信息和完整的 Vue Flow 圖數據。
 * 前端使用 Vue Flow 渲染流程圖，保存時將圖數據序列化為此結構傳給後端。
 *
 * nodes 和 edges 使用 Vue Flow 的原生格式（Node[] 和 Edge[]），
 * 序列化時直接 JSON.stringify 即可。
 */
export interface Pipeline {
  /** 流水線唯一 ID（後端生成） */
  id: string
  /** 流水線名稱 */
  name: string
  /** 流水線描述（可選） */
  description?: string
  /** Vue Flow 節點數組（JSON 序列化） */
  nodes: any[]
  /** Vue Flow 邊數組（JSON 序列化） */
  edges: any[]
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
  /** Vue Flow 節點數組 */
  nodes: any[]
  /** Vue Flow 邊數組 */
  edges: any[]
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
