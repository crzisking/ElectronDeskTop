/**
 * IT 報修工單相關類型
 *
 * 使用方：
 *  - src/api/modules/repair.api.ts
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
  /** 原始文件名（方便顯示） */
  fileName: string
}

/**
 * 提交報修請求體
 * POST /api/repair/create
 *
 * 調用前須先通過 repairApi.uploadFile() 上傳所有圖片，取得 URL 列表後再提交。
 */
export interface RepairCreateRequest {
  /** 提交人 ID（從 authStore.user.id 讀取） */
  userId: number
  /** 提交人姓名（冗余字段，後端避免 Join 用戶表） */
  userName: string
  /** 問題描述（純文字，最多 2000 字） */
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
  /** 問題描述（列表中用 show-overflow-tooltip 截斷顯示） */
  description: string
  status: RepairStatus
  userName: string
  assignedName?: string
  createTime: string
}

/**
 * 工單詳情（含附件圖片列表）
 * GET /api/repair/detail/{id} 返回的 data 字段
 */
export interface RepairDetail extends RepairListItem {
  /** 分配操作人姓名（管理員） */
  assignerName?: string
  /** 分配時間 */
  assignTime?: string
  /** 附件圖片列表（按 SortOrder 排序） */
  attachments: RepairAttachment[]
}

/**
 * 查詢工單列表請求參數
 * GET /api/repair/list?userId=xxx&status=1&pageIndex=1&pageSize=10
 */
export interface RepairListParams {
  /** 按提交人 ID 過濾（用戶查自己的工單時傳入） */
  userId?: number
  /** 狀態過濾（不傳則查全部） */
  status?: RepairStatus
  /** 按處理人 ID 過濾 */
  assignedTo?: number
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
  fileName: string
}
