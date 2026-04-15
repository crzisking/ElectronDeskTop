/**
 * 業務安排與尋找相關類型
 *
 * 使用方：
 *  - src/api/modules/business.api.ts
 *  - src/views/Business/BusinessOwnerSearch.vue
 *  - src/components/VueFlowChart/VueFlowChart.vue
 *  - src/components/VueFlowChart/nodes/*.vue
 */

// ── 流程節點類型 ───────────────────────────────────────────────────────

/**
 * 項目流程中的節點類型
 *
 * 不同類型對應不同的視覺樣式和業務含義：
 *  - start    ：流程起點（綠色圓角，每個流程只有一個）
 *  - end      ：流程終點（紅色圓角，可以有多個，代表不同結束方式）
 *  - task     ：任務節點（藍色，具體的工作項）
 *  - approval ：審批節點（橙色，需要某人審批通過才能繼續）
 *  - condition：條件分支（菱形，根據條件走不同路徑）
 */
export type FlowNodeType = 'start' | 'end' | 'task' | 'approval' | 'condition'

/**
 * 流程節點業務數據（存儲在 Vue Flow 的 node.data 中）
 *
 * 此流程圖用於靜態業務流程留存，不是動態狀態追蹤。
 * 每個節點記錄該步驟的負責人資訊，方便後續查找對應負責人。
 */
export interface FlowNodeData {
  /** 節點顯示標題（簡短描述此步驟做什麼） */
  label: string
  /** 節點類型（決定視覺樣式和業務含義） */
  nodeType: FlowNodeType
  /** 負責人工號（例如：'A12345'） */
  employeeId?: string
  /** 負責人姓名 */
  employeeName?: string
  /** 部門代碼（例如：'IT-001'） */
  departmentCode?: string
  /** 詳細描述（此步驟的具體內容、注意事項等） */
  description?: string
}

/**
 * 流程圖邊業務數據（存儲在 Vue Flow 的 edge.data 中）
 */
export interface FlowEdgeData {
  /** 邊上的文字標籤（例如：「審批通過」「條件成立」） */
  label?: string
}

// ── 業務流水線 ────────────────────────────────────────────────────────

/**
 * 業務流水線實體
 *
 * 包含基本信息和完整的 Vue Flow 圖數據。
 * nodes / edges 使用 Vue Flow 原生格式，序列化時直接 JSON.stringify。
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
  name: string
  description?: string
  nodes: any[]
  edges: any[]
}

// ── 業務負責人 ────────────────────────────────────────────────────────

/**
 * 業務負責人（搜索結果項）
 */
export interface BusinessOwner {
  id: string
  name: string
  email: string
  department: string
  title?: string
  /** 負責的業務範圍列表，例如：["採購審批", "合同簽署"] */
  responsibilities: string[]
  phone?: string
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
