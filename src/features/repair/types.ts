/**
 * IT 報修工單相關類型
 *
 * 使用方：
 *  - src/features/repair/api.ts
 *  - src/views/ITRepair/ITRepairView.vue
 *
 * 對應後端數據庫表：
 *  - IT_Repair_Request    主表（工單基本信息 + 狀態）
 *  - IT_Repair_Attachment 附件表（每張圖一行）
 */

/** 工單附件（圖片）條目 */
export interface RepairAttachment {
  /** OSS 可訪問的圖片 URL */
  fileUrl: string
}

/**
 * 匯報附件條目（IT_Repair_Result_Attachment）
 * 對應後端 RepairResultAttachmentItem，用於工單詳情頁展示 IT 匯報附件。
 */
export interface RepairResultAttachment {
  /** 附件 ID（若後端返回） */
  id?: number
  /** 原始文件名（可用於下載顯示） */
  fileName?: string
  /** OSS 可訪問的 URL（預覽或下載） */
  fileUrl: string
}

/**
 * 提交報修請求體
 * POST /api/repair/create
 *
 * 調用前須先通過 repairApi.uploadFile() 上傳所有圖片，取得 URL 列表後再提交。
 */
export interface RepairCreateRequest {
  /** 工單標題（簡短說明問題，最多 100 字） */
  title: string
  /** 問題描述（富文本 HTML，最多 2000 字） */
  description: string
  /** 已上傳 OSS 的附件列表 */
  attachments: RepairAttachment[]
}

/**
 * 提交報修響應 data 字段
 * 後端自動生成工單號（格式：R + yyyyMMddHHmmss + 4 位隨機數）
 */
export interface RepairCreateResponse {
  id: number
  requestNo: string
}

/**
 * 工單狀態值
 *  1 = 已提交（等待分配）
 *  2 = 已分配（已指派處理人）
 *  3 = 已關閉（處理完畢）
 */
export type RepairStatus = 1 | 2 | 3

/**
 * 工單列表項（不含附件，避免列表數據過重）
 * GET /api/repair/list 返回的 list 數組元素
 */
export interface RepairListItem {
  id: number
  requestNo: string
  /** 工單標題 */
  title: string
  /** 問題描述（富文本 HTML，列表中不顯示，詳情彈窗才展示） */
  description: string
  status: RepairStatus
  userName: string
  assignedName?: string
  createTime: string
}

/**
 * 工單詳情 — 用戶端查看報修工單匯報響應
 * GET /api/repair/user-report/{id} 返回的 data 字段
 *
 * 對應後端 RepairUserReportResponse，包含：
 *  1. 提問信息（來自 IT_Repair_Request）
 *  2. 用戶可見的匯報回覆（來自 IT_Repair_Result，IsUserSee=1 那一筆）
 *  3. 匯報附件列表（IT_Repair_Result_Attachment，掛在用戶可見匯報記錄下）
 *
 * 註：內部匯報（IsUserSee=0）不會返回給用戶端；尚未匯報時 resultContent/resultTime 為 null。
 */
export interface RepairDetail {
  /** 工單 ID */
  id: number
  /** 工單編號 */
  requestNo: string
  /** 問題標題 */
  title: string
  /** 問題描述（富文本 HTML，前端直接渲染） */
  description: string
  /** 提交人工號 */
  userName: string
  /** 提交時間 */
  createTime: string

  /** 匯報回覆內容（富文本 HTML）；尚未匯報時為 null */
  resultContent: string | null
  /** 匯報提交時間；尚未匯報時為 null */
  resultTime: string | null

  /** 匯報附件列表（按上傳順序排列，無附件或尚未匯報時為空陣列） */
  attachments: RepairResultAttachment[]
}

/**
 * 查詢工單列表請求參數
 * GET /api/repair/list?userId=xxx&status=1&pageIndex=1&pageSize=10
 */
export interface RepairListParams {
  /** 按提交人 ID 過濾（用戶查自己的工單時傳入） */
  userId?: string
  /** 狀態過濾（不傳則查全部） */
  status?: RepairStatus
  /** 按處理人 ID 過濾 */
  assignedTo?: string
  /** 頁碼（從 1 開始） */
  pageIndex: number
  /** 每頁條數（默認 10） */
  pageSize: number
}

/**
 * 查詢工單列表響應 data 字段
 */
export interface RepairListResponse {
  total: number
  pageIndex: number
  pageSize: number
  list: RepairListItem[]
}

/**
 * 圖片上傳響應 data 字段
 * POST /api/repair/upload — 後端中轉至 OSS，返回可訪問 URL
 */
export interface RepairUploadResponse {
  fileUrl: string
}
