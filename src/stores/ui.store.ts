/**
 * UI 狀態 Store（Pinia）
 *
 * ── 本 Store 的職責 ──────────────────────────────────────────────────
 * 管理與「界面外觀/交互狀態」相關的全局響應式數據。
 * 這類數據需要跨多個組件共享，因此放在 Pinia Store 而非組件本地 state。
 *
 * 管理的狀態：
 *  - 側邊欄展開/折疊（SidebarNav.vue 讀取，TitleBar 的漢堡按鈕切換）
 *  - 當前激活的 AI 工具 Tab（AiQuickFunctionsView 讀取）
 *  - 主窗口是否最大化（App.vue 更新，TitleBar.vue 讀取以切換按鈕圖標）
 *  - 全局加載遮罩（應用啟動時顯示，初始化完成後隱藏）
 *
 * ── 與 auth.store.ts 的關係 ─────────────────────────────────────────
 * auth.store.ts 管理「用戶身份狀態」（是否登錄、Token、用戶信息）
 * ui.store.ts  管理「界面視覺狀態」（側邊欄、最大化、加載動畫等）
 * 兩個 Store 互相獨立，各自職責清晰。
 */

// ── import 說明 ──────────────────────────────────────────────────────
// defineStore：Pinia 提供的 Store 工廠函數
//   用法：defineStore(id, setupFn)  →  返回一個 composable 函數（useXxxStore）
//   來源：pinia 套件
import { defineStore } from 'pinia'

// ref：Vue 3 響應式 API，創建可追蹤的響應式變量
//   ref(初始值) 返回一個對象，通過 .value 讀寫值
//   在 <template> 中使用時 Vue 會自動解包，不需要寫 .value
//   來源：vue 套件
import { ref } from 'vue'

// ── Store 定義 ─────────────────────────────────────────────────────
// 'ui' 是這個 Store 的唯一 ID（Vue DevTools 中顯示為 "ui" Store）
export const useUiStore = defineStore('ui', () => {

  // ═══════════════════════════════════════════════════════════════════
  // State（響應式狀態）
  // 每個 ref 都是一個「響應式盒子」。
  // 當 .value 改變時，所有模板/computed/watch 使用到它的地方自動更新。
  // ═══════════════════════════════════════════════════════════════════

  /**
   * 側邊欄是否已折疊（圖標精簡模式）
   *
   * false = 展開狀態（顯示圖標 + 文字標籤）
   * true  = 折疊狀態（只顯示圖標，文字隱藏，節省橫向空間）
   *
   * ── 在哪裡被讀取？ ─────────────────────────────────────────────────
   * src/components/layout/SidebarNav.vue：
   *   const uiStore = useUiStore()
   *   // 根據 sidebarCollapsed 動態添加 CSS class
   *   :class="{ 'sidebar--collapsed': uiStore.sidebarCollapsed }"
   *   // CSS 中 .sidebar--collapsed 縮窄寬度並隱藏文字標籤
   *
   * ── 在哪裡被修改？ ─────────────────────────────────────────────────
   * - 漢堡菜單按鈕點擊 → 調用 toggleSidebar()（TitleBar.vue 或 SidebarNav 頂部按鈕）
   * - 初始化時從 config 讀取默認值 → 調用 setSidebarCollapsed(config.sidebar.defaultCollapsed)
   *   （App.vue 或 useAppConfig composable 中設置）
   *
   * 初始值 false：應用啟動默認展開側邊欄，配置加載後可能被覆蓋
   */
  const sidebarCollapsed = ref<boolean>(false)

  /**
   * 當前激活的 AI 工具 Tab
   *
   * 控制 AiQuickFunctionsView 中右側面板顯示哪個 AI 工具界面。
   * 類型是字面量聯合類型（Union Literal Type），只允許這三個字符串之一：
   *   'text-processor' ：文本處理工具
   *   'summarizer'     ：摘要生成工具
   *   'qa'             ：問答工具
   *
   * ── 在哪裡被讀取？ ─────────────────────────────────────────────────
   * src/views/AiQuickFunctions/AiQuickFunctionsView.vue：
   *   // Tab 切換的 v-model 或 :active-name 綁定
   *   <el-tabs :model-value="uiStore.activeAiTool" @tab-click="handleTabClick">
   *
   * ── 在哪裡被修改？ ─────────────────────────────────────────────────
   * - 用戶點擊 AI 工具 Tab → 調用 setActiveAiTool(tabName)
   * - 浮球右鍵菜單點擊某 AI 工具 → 通過 IPC 事件 → App.vue → 調用 setActiveAiTool()
   *
   * 初始值 'text-processor'：默認顯示文本處理工具
   */
  const activeAiTool = ref<'text-processor' | 'summarizer' | 'qa'>('text-processor')

  /**
   * 主窗口是否已最大化（從主進程同步過來的狀態）
   *
   * ── 這個狀態為什麼存在？ ───────────────────────────────────────────
   * Electron 的「最大化」狀態屬於主進程（BrowserWindow），
   * 渲染進程（Vue 代碼）無法直接訪問。
   * 主進程通過 IPC 事件推送狀態給渲染進程，渲染進程更新這個 ref。
   *
   * ── 在哪裡被更新（寫入）？ ───────────────────────────────────────
   * src/App.vue 中監聽主進程推送的 IPC 事件：
   *   onMounted(() => {
   *     // 'push:window-maximized' 是自定義 IPC 頻道名（在 IpcChannels 常量中定義）
   *     window.electronAPI.on('push:window-maximized', (maximized: boolean) => {
   *       uiStore.setWindowMaximized(maximized)   // ← 在這裡更新
   *     })
   *   })
   * 主進程在 BrowserWindow 的 'maximize' 和 'unmaximize' 事件中向渲染進程推送。
   *
   * ── 在哪裡被讀取？ ─────────────────────────────────────────────────
   * src/components/layout/TitleBar.vue：
   *   // 根據是否最大化，切換「最大化」和「還原」按鈕的圖標
   *   <el-icon v-if="uiStore.isWindowMaximized">
   *     <Minus />        ← 最大化狀態顯示「還原」圖標
   *   </el-icon>
   *   <el-icon v-else>
   *     <FullScreen />   ← 正常狀態顯示「最大化」圖標
   *   </el-icon>
   *
   * 初始值 false：默認非最大化，App.vue 啟動後通過 IPC 查詢真實狀態並更新
   */
  const isWindowMaximized = ref<boolean>(false)

  /**
   * 全局加載遮罩（應用啟動初始化期間顯示）
   *
   * true  = 顯示加載遮罩（阻止用戶操作，防止看到未初始化的 UI 空白狀態）
   * false = 隱藏加載遮罩（所有初始化完成，應用可正常使用）
   *
   * ── 在哪裡被讀取？ ─────────────────────────────────────────────────
   * src/App.vue 根組件模板：
   *   <div v-if="uiStore.globalLoading" class="global-loading-overlay">
   *     <LoadingSpinner />
   *   </div>
   *
   * ── 在哪裡被設為 false？ ──────────────────────────────────────────
   * App.vue 的 onMounted 中，所有初始化步驟完成後調用 hideGlobalLoading()：
   *   onMounted(async () => {
   *     await authStore.restoreSession()     // 1. 恢復登錄狀態
   *     await configStore.loadConfig()       // 2. 加載應用配置
   *     // ... 其他初始化 ...
   *     uiStore.hideGlobalLoading()          // 3. 關閉遮罩
   *   })
   *
   * 初始值 true：應用啟動就顯示加載，確保用戶不會看到空白狀態
   */
  const globalLoading = ref<boolean>(true)

  // ═══════════════════════════════════════════════════════════════════
  // Actions（方法）
  // 修改上方 State 的函數。
  // 在 Pinia Setup Store 中，普通函數就是 Action。
  // ═══════════════════════════════════════════════════════════════════

  /**
   * 切換側邊欄展開/折疊狀態（Toggle）
   *
   * ! 是邏輯非（NOT）運算符：
   *   如果 sidebarCollapsed.value 是 false → 設為 true（折疊）
   *   如果 sidebarCollapsed.value 是 true  → 設為 false（展開）
   *
   * ── 在哪裡調用？ ──────────────────────────────────────────────────
   * TitleBar.vue 或 SidebarNav.vue 頂部的漢堡菜單按鈕：
   *   <el-button @click="uiStore.toggleSidebar()">
   *     <el-icon><Fold v-if="!uiStore.sidebarCollapsed" /><Expand v-else /></el-icon>
   *   </el-button>
   */
  function toggleSidebar(): void {
    sidebarCollapsed.value = !sidebarCollapsed.value
  }

  /**
   * 直接設置側邊欄折疊狀態（非 Toggle，指定具體值）
   *
   * 與 toggleSidebar 的區別：
   *   toggleSidebar：不管當前是什麼，直接取反
   *   setSidebarCollapsed：明確指定要設為展開還是折疊
   *
   * ── 在哪裡調用？ ──────────────────────────────────────────────────
   * - App.vue 初始化時，根據配置文件設置默認狀態：
   *   uiStore.setSidebarCollapsed(config.sidebar.defaultCollapsed)
   * - 響應式布局：屏幕寬度小於某閾值時自動折疊：
   *   if (windowWidth < 768) uiStore.setSidebarCollapsed(true)
   *
   * @param collapsed true = 折疊（圖標模式），false = 展開（圖標+文字模式）
   */
  function setSidebarCollapsed(collapsed: boolean): void {
    sidebarCollapsed.value = collapsed
  }

  /**
   * 切換激活的 AI 工具 Tab
   *
   * 參數類型是聯合字面量類型，TypeScript 在編譯時會阻止傳入其他字符串，
   * 確保傳入的值一定是三個有效工具名之一。
   *
   * ── 在哪裡調用？ ──────────────────────────────────────────────────
   * - AiQuickFunctionsView.vue：用戶點擊 Tab 時
   *   const handleTabClick = (tab: { name: string }) => {
   *     uiStore.setActiveAiTool(tab.name as 'text-processor' | 'summarizer' | 'qa')
   *   }
   * - App.vue：收到浮球菜單快捷操作時，直接切換到指定 AI 工具
   *
   * @param tool 要激活的工具名稱
   */
  function setActiveAiTool(tool: 'text-processor' | 'summarizer' | 'qa'): void {
    activeAiTool.value = tool
  }

  /**
   * 同步主窗口最大化狀態
   *
   * ── 在哪裡調用？ ──────────────────────────────────────────────────
   * src/App.vue 中，監聽主進程推送的 IPC 事件：
   *
   *   // onMounted 中設置監聽：
   *   window.electronAPI.on('push:window-maximized', (maximized: unknown) => {
   *     uiStore.setWindowMaximized(maximized as boolean)  // ← 這裡調用
   *   })
   *
   * 主進程（electron/main/index.ts）在何時推送此事件：
   *   mainWindow.on('maximize',   () => mainWindow.webContents.send('push:window-maximized', true))
   *   mainWindow.on('unmaximize', () => mainWindow.webContents.send('push:window-maximized', false))
   *
   * ── 整體數據流 ────────────────────────────────────────────────────
   * 用戶雙擊標題欄（或點擊最大化按鈕）
   *   → OS 觸發 Electron BrowserWindow 的 maximize 事件
   *     → 主進程推送 IPC 事件 'push:window-maximized' (true)
   *       → App.vue 監聽到事件，調用 setWindowMaximized(true)
   *         → isWindowMaximized.value = true
   *           → TitleBar.vue 響應式更新，顯示「還原」圖標
   *
   * @param maximized true = 最大化狀態，false = 普通/還原狀態
   */
  function setWindowMaximized(maximized: boolean): void {
    isWindowMaximized.value = maximized
  }

  /**
   * 隱藏全局加載遮罩
   *
   * 將 globalLoading 設為 false，告訴 App.vue 可以移除加載遮罩了。
   * 這是一個「單向」操作：遮罩一旦關閉就不應該再顯示
   * （除非應用進行大規模重新初始化，這種情況極少）。
   *
   * ── 在哪裡調用？ ──────────────────────────────────────────────────
   * src/App.vue 的 onMounted，在所有初始化步驟完成之後：
   *   onMounted(async () => {
   *     try {
   *       await authStore.restoreSession()
   *       await configStore.loadConfig()
   *       // ... 其他異步初始化 ...
   *     } finally {
   *       uiStore.hideGlobalLoading()  // ← 這裡調用，確保遮罩一定被移除
   *     }
   *   })
   */
  function hideGlobalLoading(): void {
    globalLoading.value = false
  }

  // ── Store 的公開 API ──────────────────────────────────────────────
  // return 的每個屬性都可以被外部組件通過 const uiStore = useUiStore() 訪問
  return {
    // State（響應式狀態）
    sidebarCollapsed,     // SidebarNav.vue 讀取（CSS class 綁定）
    activeAiTool,         // AiQuickFunctionsView.vue 讀取（Tab 狀態）
    isWindowMaximized,    // TitleBar.vue 讀取（最大化按鈕圖標切換）
    globalLoading,        // App.vue 讀取（控制加載遮罩顯示/隱藏）
    // Actions（方法）
    toggleSidebar,        // 漢堡按鈕點擊調用
    setSidebarCollapsed,  // 初始化/響應式布局調用
    setActiveAiTool,      // AI 工具 Tab 點擊調用
    setWindowMaximized,   // App.vue 監聽 IPC 事件後調用
    hideGlobalLoading     // App.vue 初始化完成後調用
  }
})
