/**
 * 統一平台頁面配置 — app-config.json 的 "unifiedPlatform" 區塊。
 */
export interface UnifiedPlatformConfig {
  /** 公司內部系統鏈接列表;UnifiedPlatformView.vue 遍歷渲染卡片 */
  systems: SystemLink[]
}

/**
 * systems 陣列的單一內部系統入口。
 *
 * 對應 JSON:
 *   { "id": "erp", "name": "ERP 系統", "description": "企業資源規劃",
 *     "url": "https://erp.company.internal", "iconUrl": "https://.../favicon.ico",
 *     "openMode": "iframe", "ssoEnabled": true, "ssoTokenParam": "token" }
 */
export interface SystemLink {
  /** 唯一標識符 */
  id: string

  /** 系統顯示名稱(卡片標題) */
  name: string

  /** 系統功能描述(卡片副標題) */
  description: string

  /**
   * 系統訪問地址。
   * iframe 模式作為 <iframe src="...">;external-browser 走 shell.openExternal()。
   */
  url: string

  /** 系統圖標 URL(可選);支援絕對 URL 或相對 public 路徑 */
  iconUrl?: string

  /**
   * 打開方式。
   *   'iframe'           ─ 應用內 iframe 嵌入(體驗無縫,但目標系統不能 X-Frame-Options DENY)
   *   'external-browser' ─ 系統預設瀏覽器打開(兼容所有系統,但離開應用)
   *   'electron-window'  ─ 開 Electron 子視窗
   */
  openMode: 'iframe' | 'external-browser' | 'electron-window'

  /**
   * 是否啟用 SSO 自動登錄。
   * true:打開系統時把當前 Auth Token 注入到 URL 查詢參數,
   *      最終 URL 格式 `${url}?${ssoTokenParam}=${accessToken}`。
   */
  ssoEnabled: boolean

  /** SSO Token 注入的 URL 查詢參數名(ssoEnabled 為 true 時必填) */
  ssoTokenParam?: string
}
