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

import {createHttpClient} from '../http-client'


// ── API 地址 ──────────────────────────────────────────────────────────
// VITE_REPAIR_API_URL 在 .env.development / .env.production 中配置
// 正式地址確認後填入 .env.production 的 VITE_REPAIR_API_URL
const aiSopUrl: string =
    (import.meta.env.VITE_AI_SOP_URL as string | undefined) ?? ''

// ── Axios 實例（懶創建單例） ──────────────────────────────────────────
// 使用 createHttpClient 工廠，自動附加 Auth 攔截器（Token 注入 + 錯誤處理）
let _client: ReturnType<typeof createHttpClient> | null = null
function getClient() {
    if (!_client) {
        _client = createHttpClient(aiSopUrl, 30000)
    }
    return _client
}

// ── API 方法 ──────────────────────────────────────────────────────────
export const aiSopApi = {

    /**
     * 提交報修工單
     * POST /api/repair/create
     *
     * 調用前應先通過 uploadFile() 上傳所有圖片，拿到 URL 後再調用此接口。
     *
     * @param payload 報修信息（提交人 ID/姓名 + 問題描述 + 附件 URL 列表）
     * @returns 工單 ID 和工單號
     */
    async upload(payload: FormData): Promise<{
        code: number,
        message: string,
        data: any
    }> {
        return await getClient().post('/api/aisop/uploadSop', payload)
    },




}
