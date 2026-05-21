/**
 * 個人功能配置 — app-config.json 的 "personalFunctions" 區塊。
 *
 * 「個人功能」與「內部功能」、「統一平台」同層級,作為 sidebar 第三個主功能入口。
 * 收錄為使用者個人服務、會持續產生資料的功能,例如:
 *   - 工作自動採集(本機截圖 → AI 分析 → 流水線 + 圖表)
 *   - 代辦事項(常駐視窗,同步釘釘)
 *
 * 跟 InternalFunctionsConfig 的差異:
 *   - 不需要 apiBaseUrl / apiTimeout(個人功能各自走 feature 的 env var,不共用 AI API)
 *   - openMode 加 'native-window' 表示「開啟一個常駐 Electron 視窗」(代辦事項用)
 */
export interface PersonalFunctionsConfig {
  /** 功能入口列表 */
  tools: PersonalTool[]
}

/**
 * 單一個人功能入口卡片。
 *
 * 對應 JSON:
 *   { "id": "workCollect", "name": "工作自動採集", "description": "...",
 *     "icon": "Aim", "enabled": true, "openMode": "page", "routeName": "work-collect" }
 */
export interface PersonalTool {
  /** 唯一標識符(列表 key) */
  id: string

  /** 卡片顯示名稱 */
  name: string

  /** 卡片副標題描述 */
  description: string

  /** Element Plus 圖標名稱 */
  icon: string

  /** 是否啟用(false 不顯示) */
  enabled: boolean

  /**
   * 打開方式。
   *   'page'          ─ 點擊後 router.push({ name: routeName }),走應用內路由
   *   'native-window' ─ 點擊後派發 IPC 開啟 / 切換對應的 Electron 常駐視窗(routeName 作為 dispatch key)
   */
  openMode: 'page' | 'native-window'

  /** 'page' 模式的路由名;'native-window' 模式的 dispatch key */
  routeName?: string
}
