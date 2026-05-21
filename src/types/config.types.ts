/**
 * 應用配置類型定義
 *
 * ── 這個文件的作用 ──────────────────────────────────────────────────
 * 為 config/app-config.json 文件定義完整的 TypeScript 類型。
 * 所有菜單、鏈接、API 地址均從此配置讀取，不在代碼中硬編碼（硬編碼的壞處：
 *  每次要改一個 URL 就要重新打包部署，配置驅動則只需改 JSON 文件）。
 *
 * ── 為什麼需要 TypeScript 類型？ ────────────────────────────────────
 * app-config.json 是純 JSON 文件，TypeScript 不知道它的結構。
 * 定義這些 interface 後：
 *  1. 編輯器自動補全：輸入 config. 時立即提示有哪些字段
 *  2. 類型錯誤提示：config.sidebar.iteems 拼錯了會立刻報紅
 *  3. 重構安全：重命名字段時，所有用到的地方都會提示需要更新
 *
 * ── 這些類型在哪裡被使用？ ──────────────────────────────────────────
 * 主要使用場景：
 *  - src/stores/config.store.ts：存儲加載後的配置對象（AppConfig 類型）
 *  - src/composables/useAppConfig.ts：提供配置讀取的 composable
 *  - src/types/electron.d.ts：window.electronAPI.config.read() 的返回類型
 *  - src/components/layout/SidebarNav.vue：讀取 SidebarItem[] 渲染菜單
 *  - src/views/UnifiedPlatform/UnifiedPlatformView.vue：讀取 SystemLink[]
 *  - src/views/InternalFunctions/InternalFunctionsView.vue：讀取 InternalTool[]
 *
 * ── interface 是什麼？ ────────────────────────────────────────────────
 * interface 是 TypeScript 的「結構類型描述符」，定義一個對象應該有哪些字段：
 *   interface Person { name: string; age: number }
 *   const p: Person = { name: 'Alice', age: 30 }  // 正確
 *   const q: Person = { name: 'Bob' }             // 錯誤：缺少 age
 * interface 只存在於 TypeScript 編譯階段，編譯成 JS 後完全消失。
 */

// ── 完整應用配置根接口 ────────────────────────────────────────────────
// 對應 config/app-config.json 的頂層結構：
// {
//   "version": "1.0.0",
//   "app": { ... },
//   "sidebar": { ... },
//   "floatingBall": { ... },
//   "unifiedPlatform": { ... },
//   "internalFunctions": { ... },
//   "quickContact": { ... }
// }
export interface AppConfig {
  /**
   * 應用版本號（只讀）
   * 由主進程 ConfigManager.getConfig() 從 app.getVersion()（即 package.json 的 version）動態注入，
   * 不寫入 app-config.json，也不可透過 CONFIG_WRITE 修改。
   * 唯一真實源：package.json，這樣 electron-updater 比對版本和 UI 顯示版本永遠一致。
   */
  version: string

  /**
   * 全局應用設置
   * 對應 JSON：{ "app": { "language": "zh-TW", "startMinimized": false, ... } }
   * 詳細結構見 AppSettings interface
   */
  app: AppSettings

  /**
   * 左側邊欄菜單配置
   * 對應 JSON：{ "sidebar": { "defaultCollapsed": false, "items": [...] } }
   * 詳細結構見 SidebarConfig interface
   */
  sidebar: SidebarConfig

  /**
   * 側邊欄『系統』分組外部連結配置
   * 對應 JSON：{ "systemLinks": { "items": [...] } }
   * 詳細結構見 SystemLinksConfig interface
   */
  systemLinks: SystemLinksConfig

  /**
   * 浮動小球配置
   * 對應 JSON：{ "floatingBall": { "size": 60, "opacity": 0.9, ... } }
   * 詳細結構見 FloatingBallConfig interface
   */
  floatingBall: FloatingBallConfig

  /**
   * 統一平台頁面配置
   * 對應 JSON：{ "unifiedPlatform": { "systems": [...] } }
   * 詳細結構見 UnifiedPlatformConfig interface
   */
  unifiedPlatform: UnifiedPlatformConfig

  /**
   * 內部功能配置
   * 對應 JSON：{ "internalFunctions": { "apiBaseUrl": "...", "tools": [...] } }
   * 詳細結構見 InternalFunctionsConfig interface
   */
  internalFunctions: InternalFunctionsConfig

  /**
   * 自動更新配置
   * 對應 JSON：{ "update": { "enabled": true, "feedUrl": "...", ... } }
   * 詳細結構見 UpdateConfig interface
   */
  update: UpdateConfig

  /**
   * 工作採集配置
   * 對應 JSON：{ "workCollect": { "enabled": true, "intervalMinutes": 5, ... } }
   * 詳細結構見 WorkCollectConfig interface
   */
  workCollect: WorkCollectConfig
}

// ── 工作採集 ──────────────────────────────────────────────────────────
// 對應 JSON：
// "workCollect": {
//   "enabled": true,
//   "intervalMinutes": 5,
//   "workStartHour": 8,
//   "workEndHour": 17
// }
export interface WorkCollectConfig {
  /**
   * 工作採集總開關。false 時 scheduler 不啟動,完全不採集 / 不上傳。
   * 渲染端的「啟用採集」開關透過 CONFIG_WRITE 寫入此欄位。
   */
  enabled: boolean

  /**
   * 採集間隔(分鐘)。預設 5,允許範圍 1-60。
   */
  intervalMinutes: number

  /**
   * 工時開始小時(24h),預設 8(早上 8 點)。
   * 採集只在 [workStartHour, workEndHour) 區間內進行,其餘時段 tick 跳過。
   */
  workStartHour: number

  /**
   * 工時結束小時(24h),預設 17(下午 5 點),「不含」此小時。
   * 設 17 表示 17:00:00 整就停止採集(覆蓋 8:00 ~ 16:59:59)。
   */
  workEndHour: number
}

// ── 自動更新 ──────────────────────────────────────────────────────────
// 對應 JSON：
// "update": {
//   "enabled": true,
//   "feedUrl": "http://192.168.120.135:10001/",
//   "channel": "latest",
//   "dailyCheckTime": "11:00",
//   "autoDownload": true,
//   "autoInstallOnAppQuit": false
// }
export interface UpdateConfig {
  /**
   * 自動更新總開關
   * false 時整個 update-manager 不會啟動，相當於關閉自動更新功能
   */
  enabled: boolean

  /**
   * 更新源（內網靜態服務器，結尾必須帶 "/"）
   * 服務器需提供 latest.yml + 安裝包 + blockmap
   */
  feedUrl: string

  /**
   * 發布通道：對應服務器上的 latest.yml / beta.yml / alpha.yml
   * 一般生產環境用 "latest"；灰度測試可用 "beta"
   */
  channel: 'latest' | 'beta' | 'alpha'

  /**
   * 每日定時檢查時刻（24 小時制，HH:MM 格式，如 "11:00"）
   * 應用啟動時會計算「下一次到達該時刻的時間差」並安排首次檢查；
   * 之後每 24 小時觸發一次。設為空字串則不啟用定時檢查（仍可手動觸發）。
   *
   * 範例：
   *   "11:00" → 每天中午 11 點檢查
   *   "03:30" → 每天凌晨 3:30 檢查
   *   ""     → 不定時檢查
   */
  dailyCheckTime: string

  /**
   * 發現新版時是否自動下載
   * true：背景自動下載完，等用戶在彈窗點「立即重啟」
   * false：先彈通知問用戶要不要下載
   */
  autoDownload: boolean

  /**
   * 下載完成後是否在應用退出時靜默安裝
   * true：用戶下次關閉應用時自動安裝，無需主動點重啟
   * false：必須用戶主動點「立即重啟」才安裝
   */
  autoInstallOnAppQuit: boolean
}

// ── 全局設置 ──────────────────────────────────────────────────────────
// 對應 JSON：
// "app": {
//   "language": "zh-TW",
//   "startMinimized": false,
//   "launchOnStartup": true
// }
//
// 注意：本應用只支持單一亮色主題，不提供 theme 切換。
// 過去保留過 theme 字段但無實際實現，已於 2026-05 統一移除。
export interface AppSettings {
  /**
   * 界面語言（字面量聯合類型）
   * 只能是這兩個值之一，其他值 TypeScript 會報錯：
   *   'zh-TW' ：繁體中文（台灣）
   *   'en'    ：英文
   * 在哪裡用：i18n 國際化配置，設置 vue-i18n 的 locale
   */
  language: 'zh-TW' | 'en'

  /**
   * 啟動時直接顯示浮球（跳過主窗口）
   * true  ：適合「輕量使用者」——不需要主窗口，直接用浮球快速操作
   * false ：默認，啟動時顯示主窗口
   * 在哪裡用：electron/main/index.ts 創建窗口時的判斷邏輯
   */
  startMinimized: boolean

  /**
   * 是否加入系統開機自啟動
   * true  ：在注冊表（Windows）或 LaunchAgent（macOS）中添加啟動項
   * false ：不自啟動
   * 在哪裡用：主進程通過 Electron 的 app.setLoginItemSettings() 實現
   */
  launchOnStartup: boolean
}

// ── 側邊欄 ────────────────────────────────────────────────────────────
// 對應 JSON：
// "sidebar": {
//   "defaultCollapsed": false,
//   "items": [ { "id": "...", "label": "...", ... }, ... ]
// }
export interface SidebarConfig {
  /**
   * 應用啟動時側邊欄是否默認折疊
   * true  ：啟動時折疊（圖標模式，節省空間）
   * false ：啟動時展開（圖標+文字，更直觀）
   * 在哪裡用：App.vue 初始化時調用 uiStore.setSidebarCollapsed(config.sidebar.defaultCollapsed)
   */
  defaultCollapsed: boolean

  /**
   * 菜單項列表
   * 渲染順序與數組順序一致（JSON 中靠前的先顯示）
   * 在哪裡用：SidebarNav.vue 用 v-for="item in config.sidebar.items" 遍歷渲染
   */
  items: SidebarItem[]
}

// 對應 sidebar.items 數組中的每一個元素
// 對應 JSON：
// {
//   "id": "unified-platform",
//   "label": "統一平台",
//   "icon": "Grid",
//   "routeName": "unified-platform",
//   "enabled": true,
//   "badge": "New"
// }
export interface SidebarItem {
  /**
   * 唯一標識符
   * 建議與 routeName 保持一致，方便查找關聯關係
   * 在哪裡用：v-for 的 :key 綁定，避免 Vue 重新渲染時的性能問題
   */
  id: string

  /**
   * 顯示文字
   * 側邊欄展開時顯示在圖標右側
   * 折疊時通過 CSS 隱藏，但鼠標懸停時作為 tooltip 顯示
   */
  label: string

  /**
   * 圖標標識
   * 支持 Element Plus 圖標名稱（駝峰格式）
   * 例如："Grid" → <el-icon><Grid /></el-icon>
   * 完整圖標庫：https://element-plus.org/zh-CN/component/icon.html
   * 在哪裡用：SidebarNav.vue 動態渲染圖標
   */
  icon: string

  /**
   * Vue Router 命名路由的 name 字段
   * 點擊菜單項時執行：router.push({ name: item.routeName })
   * 命名路由比路徑路由更安全（路徑改變不影響這裡）
   * 對應 router/index.ts 中各路由的 name 屬性
   */
  routeName: string

  /**
   * 是否啟用此菜單項
   * false：該菜單項不渲染（v-if="item.enabled"）
   * 注意：這是「軟隱藏」，路由本身仍然可以通過 URL 直接訪問
   * 用途：在不重新打包的情況下，通過修改 JSON 快速隱藏/顯示功能入口
   */
  enabled: boolean

  /**
   * 徽標文字（可選字段，? 表示可以不存在）
   * 顯示在菜單項右側，用於提示新功能或未讀數量
   * 例如："New"、"Beta"、"99+"
   * 不設置此字段 = 不顯示徽標
   */
  badge?: string
}

// ── 側邊欄『系統』分組外部連結 ────────────────────────────────────────
// 對應 JSON：
// "systemLinks": {
//   "items": [ { "id": "docs-center", "label": "文檔中心", ... } ]
// }
//
// 為什麼跟 sidebar.items 分開：
//  sidebar.items 是路由跳轉項（routeName 驅動內部頁面），
//  systemLinks.items 則是外部 URL 入口，點擊用默認瀏覽器打開，
//  語義不同。混在一起會讓徽標計數、路由高亮邏輯混亂。
export interface SystemLinksConfig {
  /**
   * 連結列表（渲染順序與數組順序一致）
   * 在哪裡用：SidebarNav.vue「系統」分組 v-for 渲染
   */
  items: SystemLinkItem[]
}

export interface SystemLinkItem {
  /** 唯一標識符（v-for key） */
  id: string

  /** 顯示文字（折疊狀態下作為 tooltip） */
  label: string

  /**
   * Element Plus 圖標名稱（駝峰格式）
   * 例：'Document' → <el-icon><Document /></el-icon>
   */
  icon: string

  /**
   * 點擊後打開的完整 URL
   * 透過 window.open(url, '_blank')；Electron 的 setWindowOpenHandler
   * 會攔截並轉為 shell.openExternal，由系統默認瀏覽器處理
   */
  url: string

  /** 是否啟用（false 時不渲染） */
  enabled: boolean
}

// ── 浮動小球 ──────────────────────────────────────────────────────────
// 對應 JSON：
// "floatingBall": {
//   "size": 60,
//   "opacity": 0.9,
//   "defaultPosition": { "x": 100, "y": 200 },
//   "snapToEdge": true,
//   "quickMenu": [ ... ]
// }
export interface FloatingBallConfig {
  /**
   * 浮球直徑（像素）
   * 推薦範圍 48~72px，默認 60px
   * 太小：難以點擊；太大：遮擋屏幕內容
   * 在哪裡用：浮球窗口的 CSS width/height，或通過 IPC 設置窗口尺寸
   */
  size: number

  /**
   * 浮球透明度
   * 範圍 0.0（完全透明）~ 1.0（完全不透明），默認 0.9
   * 微透明讓用戶能看到浮球後面的內容
   * 在哪裡用：浮球組件的 CSS opacity 屬性
   */
  opacity: number

  /**
   * 浮球首次顯示的屏幕座標（對象類型）
   * 相對屏幕左上角，單位：像素
   * { x: number; y: number } 是內聯的對象類型定義
   * 等同於：先定義 interface Position { x: number; y: number }，再用 Position
   * 在哪裡用：主進程創建浮球窗口時的初始 x、y 位置
   */
  defaultPosition: { x: number; y: number }

  /**
   * 拖動停止後是否自動吸附到最近的屏幕邊緣
   * true  ：鬆開鼠標後浮球會滑動到最近的屏幕邊緣（常見設計模式，防止擋住屏幕中央）
   * false ：拖到哪裡就停在哪裡
   * 在哪裡用：浮球組件的 stopDrag 邏輯中判斷是否觸發吸附動畫
   */
  snapToEdge: boolean

  /**
   * 右鍵菜單項列表
   * 右鍵點擊浮球時顯示的快捷菜單
   * 在哪裡用：主進程的 showContextMenu IPC handler 中讀取，
   *            使用 Electron Menu.buildFromTemplate() 構建原生菜單
   */
  quickMenu: QuickMenuItem[]
}

// 對應 quickMenu 數組中的每一個菜單項
// 對應 JSON：
// {
//   "id": "show-main",
//   "label": "打開主窗口",
//   "icon": "Monitor",
//   "action": { "type": "show-main-window" },
//   "enabled": true,
//   "separator": false
// }
export interface QuickMenuItem {
  /** 唯一標識符，用於列表渲染的 key */
  id: string

  /**
   * 顯示文字
   * separator 分隔線項可以為空字符串 ""
   * 分隔線由 separator 字段控制，label 只影響文字顯示
   */
  label: string

  /**
   * Element Plus 圖標名稱（可選）
   * 菜單項左側顯示的小圖標
   * 不設置則不顯示圖標
   */
  icon?: string

  /**
   * 點擊後執行的操作
   * 類型是 QuickMenuAction（判別聯合類型），見下方詳細說明
   */
  action: QuickMenuAction

  /**
   * 是否啟用此菜單項
   * false：v-if 或 filter 過濾掉，不渲染這個菜單項
   */
  enabled: boolean

  /**
   * 是否在此項後面渲染分隔線（可選，默認不顯示）
   * 用於視覺上分組菜單項
   * 例如：「打開主窗口」「切換到AI工具」--- 分隔線 --- 「退出應用」
   */
  separator?: boolean
}

/**
 * 浮球快捷菜單操作類型（判別聯合類型 / Discriminated Union）
 *
 * ── 什麼是判別聯合類型？ ────────────────────────────────────────────
 * 聯合類型（Union Type）用 | 連接多個類型，表示「可以是其中任何一個」：
 *   type A = TypeX | TypeY | TypeZ
 *
 * 「判別」（Discriminated）是指：每個成員類型都有一個共同的字段（type），
 * 且每個成員的 type 值是唯一的字符串字面量（'show-main-window'、'navigate' 等）。
 * TypeScript 通過 type 字段自動推斷出具體是哪個成員類型。
 *
 * ── 實際使用示例 ──────────────────────────────────────────────────
 * function executeAction(action: QuickMenuAction) {
 *   switch (action.type) {
 *     case 'show-main-window':
 *       // TypeScript 知道這裡 action 只有 type 字段（沒有 routeName 或 url）
 *       window.electronAPI.window.show()
 *       break
 *
 *     case 'navigate':
 *       // TypeScript 知道這裡 action 有 routeName 字段（類型是 string）
 *       // 如果不在 'navigate' 分支嘗試訪問 action.routeName，TypeScript 會報錯
 *       router.push({ name: action.routeName })
 *       break
 *
 *     case 'open-url':
 *       // TypeScript 知道這裡有 url（string）和 target（'browser' | 'iframe'）
 *       if (action.target === 'browser') {
 *         window.open(action.url)
 *       } else {
 *         // 在 iframe 中打開
 *       }
 *       break
 *
 *     case 'quit-app':
 *       app.quit()  // 主進程直接調用
 *       break
 *   }
 * }
 *
 * ── 對應 JSON 示例 ────────────────────────────────────────────────
 * { "type": "show-main-window" }
 * { "type": "navigate", "routeName": "internal-functions" }
 * { "type": "open-url", "url": "https://example.com", "target": "browser" }
 * { "type": "quit-app" }
 *
 * ── 在哪裡被使用？ ──────────────────────────────────────────────
 * - 主進程的 ipc-handlers/index.ts 透過原生 Menu.popup() 分派 action.type:
 *   show-main-window / navigate / open-url / quit-app 全部在主進程一站式處理。
 * - navigate 場景：主進程 webContents.send(IpcChannels.PUSH_BALL_NAVIGATE, routeName)
 *   → 主窗口 App.vue 訂閱該頻道並呼叫 router.push。
 */
export type QuickMenuAction =
  // 顯示主窗口（最常用操作，相當於「打開應用」）
  | { type: 'show-main-window' }
  // 在主窗口內導航到指定路由（routeName 對應 router/index.ts 中的路由 name）
  | { type: 'navigate'; routeName: string }
  // 打開指定 URL（target 決定在應用內 iframe 還是外部瀏覽器打開）
  | { type: 'open-url'; url: string; target: 'browser' | 'iframe' }
  // 退出整個 Electron 應用（調用 app.quit()）
  | { type: 'quit-app' }

// ── 統一平台 ──────────────────────────────────────────────────────────
// 對應 JSON：
// "unifiedPlatform": {
//   "systems": [ { ... }, { ... } ]
// }
export interface UnifiedPlatformConfig {
  /**
   * 公司內部系統鏈接列表
   * 在哪裡用：UnifiedPlatformView.vue 遍歷渲染系統入口卡片
   */
  systems: SystemLink[]
}

// 對應 systems 數組中的每一個內部系統入口
// 對應 JSON：
// {
//   "id": "erp",
//   "name": "ERP 系統",
//   "description": "企業資源規劃",
//   "url": "https://erp.company.internal",
//   "iconUrl": "https://erp.company.internal/favicon.ico",
//   "openMode": "iframe",
//   "ssoEnabled": true,
//   "ssoTokenParam": "token"
// }
export interface SystemLink {
  /** 唯一標識符（用於列表 key） */
  id: string

  /** 系統顯示名稱（卡片標題） */
  name: string

  /** 系統功能描述（卡片副標題/提示文字） */
  description: string

  /**
   * 系統訪問地址
   * iframe 模式下作為 <iframe src="...">
   * external-browser 模式下通過 shell.openExternal() 打開
   */
  url: string

  /**
   * 系統圖標 URL（可選）
   * 支持絕對 URL（https://...）或相對 public 目錄的路徑（/icons/erp.png）
   * 不設置此字段 = 使用默認圖標（代碼中提供 fallback）
   */
  iconUrl?: string

  /**
   * 打開方式
   * 'iframe'           ：在應用內 iframe 嵌入
   *   優點：無縫集成體驗，可以注入 SSO Token
   *   缺點：需要系統允許 iframe 嵌入（X-Frame-Options 不能是 DENY）
   * 'external-browser' ：在系統默認瀏覽器中打開
   *   優點：兼容所有系統，不受 iframe 限制
   *   缺點：離開了應用界面，體驗割裂
   */
  openMode: 'iframe' | 'external-browser' | 'electron-window'

  /**
   * 是否啟用 SSO 自動登錄
   * true：打開系統時，將當前用戶的 Auth Token 注入到 URL 查詢參數
   *        最終 URL 格式：${url}?${ssoTokenParam}=${accessToken}
   * false：直接打開 URL，不注入 Token（用戶需要手動登錄目標系統）
   */
  ssoEnabled: boolean

  /**
   * SSO Token 注入的 URL 查詢參數名（ssoEnabled 為 true 時必填）
   * 例如：ssoTokenParam = "token" 時，最終 URL = "https://erp.company.internal?token=eyJ..."
   * 不同系統可能使用不同的參數名（token、jwt、authToken 等），此字段提供靈活性
   */
  ssoTokenParam?: string
}

// ── 內部功能 ────────────────────────────────────────────────────────
// 對應 JSON：
// "internalFunctions": {
//   "apiBaseUrl": "https://ai-api.company.internal/v1",
//   "apiTimeout": 30000,
//   "tools": [ { ... } ]
// }
export interface InternalFunctionsConfig {
  /**
   * 後端 API 基礎地址（供 AI 類工具使用）
   * 所有 AI 請求的根 URL，具體接口路徑會在此之後拼接
   * 例如：apiBaseUrl = "https://ai-api.company.internal/v1"
   * 在哪裡用：src/api/ai.api.ts 中 axios 實例的 baseURL 配置
   */
  apiBaseUrl: string

  /**
   * 請求超時（毫秒）
   * 例如：30000 = 30 秒
   * 在哪裡用：axios 實例配置的 timeout 字段
   */
  apiTimeout: number

  /**
   * 功能入口列表（可同時放 AI 工具與公司內部功能）
   * 每個條目對應一張功能卡片，config 驅動渲染，不需要改代碼就能增減
   */
  tools: InternalTool[]
}

/**
 * 單個內部功能入口定義
 * 對應 JSON：
 * {
 *   "id": "bpmUserFinder",
 *   "name": "BPM 負責人查詢",
 *   "description": "查找對應的 BPM 表單負責人",
 *   "icon": "Edit",
 *   "enabled": true,
 *   "openMode": "page",
 *   "routeName": "ai-bpm-finder",
 *   "url": "http://..."
 * }
 */
export interface InternalTool {
  /** 唯一標識符（列表 key，也可用於功能統計/埋點） */
  id: string

  /** 工具卡片顯示名稱 */
  name: string

  /** 工具功能描述（卡片副標題） */
  description: string

  /**
   * Element Plus 圖標名稱
   * 在工具卡片左側/頂部顯示，增加視覺識別度
   */
  icon: string

  /**
   * 是否啟用此工具卡片
   * false：v-if 過濾掉，不顯示此工具入口
   * 用於灰度發布：先在 config 中 enabled: false，功能就緒後改為 true
   */
  enabled: boolean

  /**
   * 打開方式
   * 'page'    ：在右側內容區顯示對應的子頁面（routeName 字段必填）
   *              點擊後 router.push({ name: tool.routeName })
   * 'external'：在外部瀏覽器打開（url 字段必填）
   *              點擊後 shell.openExternal(tool.url)
   */
  openMode: 'page' | 'external'

  /**
   * openMode 為 'page' 時跳轉的路由名稱（可選）
   * 對應 router/index.ts 中路由的 name 字段
   */
  routeName?: string

  /**
   * openMode 為 'external' 時打開的完整 URL（可選）
   * 例如："https://chat.openai.com"
   */
  url?: string
}
