/**
 * IT 報修工單 API 模塊
 *
 * 對接 IT 報修後端服務，提供以下接口：
 *  - create     : 提交報修工單（前端先上傳圖片取得 URL，再一次性提交）
 *  - list       : 查詢工單列表（支持狀態過濾、提交人過濾、分頁）
 *  - detail     : 查詢工單詳情（含附件圖片列表）
 *  - uploadFile : 圖片上傳至後端（後端中轉至 OSS，返回可訪問 URL）
 *
 * ── URL 配置 ────────────────────────────────────────────────────────
 * 通過環境變量 VITE_REPAIR_API_URL 切換環境：
 *  測試環境：.env.development 中設為 http://localhost:5247
 *  正式環境：.env.production  中填入正式地址（待確認後填入）
 *
 * 若未設置環境變量，回退到 http://localhost:5247（便於本地開發）
 */

import {createHttpClient} from '@/api/http-client'
import type {
  RepairCreateRequest,
  RepairCreateResponse,
  RepairDetail,
  RepairListParams,
  RepairListResponse,
  RepairUploadResponse
} from './types'

// ── API 地址 ──────────────────────────────────────────────────────────
// VITE_REPAIR_API_URL 在 .env.development / .env.production 中配置
// 正式地址確認後填入 .env.production 的 VITE_REPAIR_API_URL
const REPAIR_BASE_URL: string =
  (import.meta.env.VITE_REPAIR_API_URL as string | undefined) ?? 'http://localhost:5247'

// ── Axios 實例（懶創建單例） ──────────────────────────────────────────
// 使用 createHttpClient 工廠，自動附加 Auth 攔截器（Token 注入 + 錯誤處理）
let _client: ReturnType<typeof createHttpClient> | null = null
function getClient() {
  if (!_client) {
    _client = createHttpClient(REPAIR_BASE_URL, 30000)
  }
  return _client
}

// ── API 方法 ──────────────────────────────────────────────────────────
export const repairApi = {

  /**
   * 提交報修工單
   * POST /api/repair/create
   *
   * 調用前應先通過 uploadFile() 上傳所有圖片，拿到 URL 後再調用此接口。
   * 攔截器已返回 data（業務數據），泛型直接對應 RepairCreateResponse。
   *
   * @param payload 報修信息（提交人 ID/姓名 + 問題描述 + 附件 URL 列表）
   * @returns 工單 ID 和工單號
   */
  async create(payload: RepairCreateRequest): Promise<RepairCreateResponse> {
    return await getClient().post<RepairCreateResponse>('/api/repair/create', payload)
  },

  /**
   * 查詢工單列表
   * GET /api/repair/list?userId=xxx&status=1&pageIndex=1&pageSize=10
   *
   * 列表不含附件圖片，詳情接口才帶圖片（避免列表數據過重）。
   * 攔截器已返回 data（業務數據），泛型直接對應 RepairListResponse。
   *
   * @param params 查詢參數（userId、status、pageIndex、pageSize）
   * @returns 分頁結果（total + list）
   */
  async list(params: RepairListParams): Promise<RepairListResponse> {
    return await getClient().get<RepairListResponse>('/api/repair/list', {params})
  },

  /**
   * 查詢工單詳情（用戶端查看報修匯報響應）
   * GET /api/repair/user-report/{id}
   *
   * 攔截器已返回 data（業務數據），泛型直接對應 RepairDetail。
   *
   * @param id 工單 ID
   * @returns 工單提問 + 匯報回覆 + 附件
   */
  async detail(id: number): Promise<RepairDetail> {
    return await getClient().get<RepairDetail>(`/api/repair/user-report/${id}`)
  },

  /**
   * 上傳圖片(後端中轉至 OSS)
   * POST /api/repair/upload
   * Content-Type: multipart/form-data
   *
   * 後端實際返回 `{ code, message, data: "http://..." }`,interceptor 剝層後 `data` 是**字串**(OSS URL),
   * **不是** `{ fileUrl }` 物件。這裡統一兜底兩種形態:
   *   - 字串 → 直接當 fileUrl
   *   - 物件 → 取 .fileUrl(向後兼容,萬一後端改回物件)
   * 對外仍保持 `{ fileUrl }` 介面,呼叫方(useRepairUpload)零修改。
   *
   * @param file 要上傳的圖片文件
   * @returns { fileUrl }
   */
  async uploadFile(file: File): Promise<RepairUploadResponse> {
    const form = new FormData()
    form.append('file', file)
      const result = await getClient().post<unknown>('/api/repair/upload', form)
      if (typeof result === 'string') return {fileUrl: result}
      if (result && typeof result === 'object' && 'fileUrl' in result) {
          return result as RepairUploadResponse
      }
      throw new Error('上傳介面回傳格式異常,無法解析 fileUrl')
  },

  /**
   * 上傳端點完整 URL
   * 可直接傳給 el-upload 的 action 屬性（備用方案，優先使用 http-request 自定義上傳）
   */
  uploadUrl: `${REPAIR_BASE_URL}/api/repair/upload`
}
