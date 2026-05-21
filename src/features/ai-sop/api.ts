/**
 * AI SOP 上傳 API 模塊
 *
 * 對接 AI SOP 文件上傳服務，提供上傳接口。
 *
 * ── URL 配置 ────────────────────────────────────────────────────────
 * 通過環境變量 VITE_AI_SOP_URL 切換環境：
 *  測試環境：.env.development 中設置
 *  正式環境：.env.production  中設置
 *
 * ── 響應結構 ────────────────────────────────────────────────────────
 * 後端返回 { code, message, data }，攔截器剝離後直接返回 data。
 * AiSop 的 data 是文件 ID（字串或數字），與報修上傳的 { fileUrl } 不同。
 */

import {createHttpClient} from '@/api/http-client'

const aiSopUrl: string =
    (import.meta.env.VITE_AI_SOP_URL as string | undefined) ?? ''

let _client: ReturnType<typeof createHttpClient> | null = null
function getClient() {
    if (!_client) {
        _client = createHttpClient(aiSopUrl, 30000)
    }
    return _client
}

export const aiSopApi = {

    /**
     * 上傳 SOP 文件
     * POST /api/aisop/uploadSop
     *
     * 攔截器已返回 data（業務數據），AiSop 的 data 是文件 ID。
     * 返回類型為 unknown，由調用方根據實際後端結構處理。
     *
     * @param payload 包含 SOP 文件的 FormData
     * @returns 後端返回的業務數據（文件 ID 等）
     */
    async upload(payload: FormData): Promise<unknown> {
        return await getClient().post('/api/aisop/uploadSop', payload)
    }
}
