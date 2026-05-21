/**
 * 內部功能配置 — app-config.json 的 "internalFunctions" 區塊。
 */
export interface InternalFunctionsConfig {
  /**
   * 後端 API 基礎地址(供 AI 類工具使用)。
   * 用於 src/api/ai.api.ts 中 axios 實例的 baseURL。
   */
  apiBaseUrl: string

  /** 請求超時(ms),例 30000 = 30 秒 */
  apiTimeout: number

  /** 功能入口列表(AI 工具 + 公司內部功能混合) */
  tools: InternalTool[]
}

/**
 * 單一內部功能入口定義。
 *
 * 對應 JSON:
 *   { "id": "bpmUserFinder", "name": "BPM 負責人查詢", "description": "...",
 *     "icon": "Edit", "enabled": true, "openMode": "page", "routeName": "ai-bpm-finder" }
 */
export interface InternalTool {
  /** 唯一標識符(列表 key + 可用於埋點) */
  id: string

  /** 卡片顯示名稱 */
  name: string

  /** 卡片副標題描述 */
  description: string

  /** Element Plus 圖標名稱(卡片左側 / 頂部) */
  icon: string

  /**
   * 是否啟用(false 時不顯示)。
   * 灰度發布:先 enabled=false 上線、功能就緒後改 true。
   */
  enabled: boolean

  /**
   * 打開方式。
   *   'page'     ─ 右側內容區顯示子頁(routeName 必填),router.push({ name })
   *   'external' ─ 外部瀏覽器打開(url 必填),shell.openExternal(url)
   */
  openMode: 'page' | 'external'

  /** 'page' 模式跳轉的路由名稱;對應 router/index.ts 路由的 name 字段 */
  routeName?: string

  /** 'external' 模式打開的完整 URL */
  url?: string
}
