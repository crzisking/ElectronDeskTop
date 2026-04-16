/**
 * 業務安排與尋找 API 模組
 *
 * ── 職責 ──────────────────────────────────────────────────────────────
 * 封裝「業務流水線」和「業務負責人搜索」的 HTTP 請求。
 * 所有 API 端點地址從 app-config.json 的 business 配置中讀取，
 * 不在代碼中硬編碼 URL。
 *
 * ── 接口清單 ──────────────────────────────────────────────────────────
 *
 * 流水線 CRUD：
 *   getPipelines()         → GET    {pipelineApiEndpoint}
 *   getPipelineById(id)    → GET    {pipelineApiEndpoint}/{id}
 *   savePipeline(data)     → POST   {pipelineApiEndpoint}
 *   updatePipeline(id, d)  → PUT    {pipelineApiEndpoint}/{id}
 *   deletePipeline(id)     → DELETE {pipelineApiEndpoint}/{id}
 *
 * 業務負責人搜索：
 *   searchOwners(keyword)  → GET    {ownerSearchApiEndpoint}?q={keyword}
 *
 * ── 使用方式 ──────────────────────────────────────────────────────────
 * import { useBusinessApi } from '@/api/modules/business.api'
 *
 * const businessApi = useBusinessApi()
 * const pipelines = await businessApi.getPipelines()
 * const owners = await businessApi.searchOwners('採購')
 *
 * ── TODO ──────────────────────────────────────────────────────────────
 * 以下接口均為預留，目前返回模擬數據或 console.log。
 * 後端 API 就緒後，取消註釋中的 HTTP 請求代碼即可。
 */

import { useConfigStore } from '@/stores/config.store'
// import { createHttpClient } from '@/api/http-client'
import type {
  Pipeline,
  PipelineListResponse,
  SavePipelineRequest,
  BusinessOwner,
  BusinessOwnerSearchResponse
} from '@/types/api.types'

/**
 * 業務 API Composable
 *
 * 使用 Vue Composable 模式（use 前綴函數），
 * 在組件 setup 中調用，自動獲取配置 store 中的 API 端點。
 */
export function useBusinessApi() {
  const configStore = useConfigStore()

  /**
   * 獲取業務配置
   * 從 config store 讀取 business 區塊的配置
   */
  function getConfig() {
    const config = configStore.businessConfig
    if (!config) {
      throw new Error('[BusinessApi] 業務配置未加載，請確認 app-config.json 中的 business 區塊')
    }
    return config
  }

  // ═══════════════════════════════════════════════════════════════
  // 流水線 CRUD 接口
  // ═══════════════════════════════════════════════════════════════

  /**
   * 獲取所有流水線列表
   *
   * @returns Promise<PipelineListResponse>
   *
   * TODO: 接入後端
   *   const config = getConfig()
   *   const client = createHttpClient(config.pipelineApiEndpoint, 10000)
   *   const { data } = await client.get<PipelineListResponse>('')
   *   return data
   */
  async function getPipelines(): Promise<PipelineListResponse> {
    // 模擬返回空列表
    return { pipelines: [], total: 0 }
  }

  /**
   * 獲取單條流水線詳情（含 X6 圖數據）
   *
   * @param id 流水線 ID
   * @returns Promise<Pipeline>
   *
   * TODO: 接入後端
   *   const config = getConfig()
   *   const client = createHttpClient(config.pipelineApiEndpoint, 10000)
   *   const { data } = await client.get<Pipeline>(`/${id}`)
   *   return data
   */
  async function getPipelineById(id: string): Promise<Pipeline> {
    // 模擬返回
    return {
      id,
      name: '模擬流水線',
      nodes: [],
      edges: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  }

  /**
   * 新增流水線
   *
   * @param data 流水線數據（名稱 + X6 圖的 nodes/edges）
   * @returns Promise<Pipeline> 創建後的完整流水線（含後端生成的 id）
   *
   * TODO: 接入後端
   *   const config = getConfig()
   *   const client = createHttpClient(config.pipelineApiEndpoint, 10000)
   *   const { data: result } = await client.post<Pipeline>('', data)
   *   return result
   */
  async function savePipeline(data: SavePipelineRequest): Promise<Pipeline> {
    // 模擬返回
    return {
      id: `pipeline-${Date.now()}`,
      name: data.name,
      description: data.description,
      nodes: data.nodes,
      edges: data.edges,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  }

  /**
   * 更新流水線
   *
   * @param id   流水線 ID
   * @param data 更新的數據
   * @returns Promise<Pipeline> 更新後的完整流水線
   *
   * TODO: 接入後端
   *   const config = getConfig()
   *   const client = createHttpClient(config.pipelineApiEndpoint, 10000)
   *   const { data: result } = await client.put<Pipeline>(`/${id}`, data)
   *   return result
   */
  async function updatePipeline(id: string, data: SavePipelineRequest): Promise<Pipeline> {
    return {
      id,
      name: data.name,
      description: data.description,
      nodes: data.nodes,
      edges: data.edges,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  }

  /**
   * 刪除流水線
   *
   * @param id 流水線 ID
   *
   * TODO: 接入後端
   *   const config = getConfig()
   *   const client = createHttpClient(config.pipelineApiEndpoint, 10000)
   *   await client.delete(`/${id}`)
   */
  async function deletePipeline(_id: string): Promise<void> {
    // TODO: 接入後端後實現刪除邏輯
  }

  // ═══════════════════════════════════════════════════════════════
  // 業務負責人搜索接口
  // ═══════════════════════════════════════════════════════════════

  /**
   * 搜索業務負責人
   *
   * @param keyword 搜索關鍵詞（業務名稱、職責描述等）
   * @returns Promise<BusinessOwnerSearchResponse>
   *
   * TODO: 接入後端
   *   const config = getConfig()
   *   const client = createHttpClient(config.ownerSearchApiEndpoint, 10000)
   *   const { data } = await client.get<BusinessOwnerSearchResponse>('', {
   *     params: { q: keyword, limit: config.maxSearchResults }
   *   })
   *   return data
   */
  async function searchOwners(_keyword: string): Promise<BusinessOwnerSearchResponse> {
    // 模擬返回
    return { owners: [], total: 0 }
  }

  // 返回所有可用的 API 方法
  return {
    // 流水線 CRUD
    getPipelines,
    getPipelineById,
    savePipeline,
    updatePipeline,
    deletePipeline,
    // 負責人搜索
    searchOwners
  }
}
