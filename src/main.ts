/**
 * 主窗口 Vue 應用入口文件
 *
 * ═══════════════════════════════════════════════════════
 * 這個文件做什麼？
 *   這是主窗口的 Vue 應用啟動文件。
 *   Electron 打開窗口後會加載 src/index.html，
 *   index.html 引用了這個文件，Vue 從這裡開始啟動。
 *
 * 在哪裡被用到？
 *   src/index.html → <script src="./main.ts">
 *
 * 執行順序：
 *   1. 創建 Vue 實例
 *   2. 注冊所有插件（Pinia、Router、ElementPlus、圖標）
 *   3. 掛載到 #app（index.html 裡的 <div id="app">）
 *   4. App.vue 的 onMounted 開始執行
 * ═══════════════════════════════════════════════════════
 */

// ─── Vue 核心 ─────────────────────────────────────────────────────
// createApp：創建 Vue 應用實例的函數，每個窗口只調用一次
import { createApp } from 'vue'

// ─── Pinia 狀態管理 ───────────────────────────────────────────────
// createPinia：創建全局 Store 容器
// 注冊後，所有組件可以通過 useXxxStore() 訪問共享數據
// 文件位置：node_modules/pinia
import { createPinia } from 'pinia'

// ─── Element Plus UI 組件庫 ───────────────────────────────────────
// Element Plus：提供 el-button、el-input、el-table 等 300+ UI 組件
// 全量引入（不做按需加載），因為桌面應用包大小不是首要考慮
// 文件位置：node_modules/element-plus
import ElementPlus from 'element-plus'

// Element Plus 繁體中文語言包
// 讓組件內部文字（如分頁"上一頁"、表單"請輸入"）顯示繁體中文
// 文件位置：node_modules/element-plus/es/locale/lang/zh-tw
import zhTw from 'element-plus/es/locale/lang/zh-tw'

// Element Plus 默認樣式（必須引入，否則組件沒有樣式）
// 注意：必須在 global.css 之前引入，才能被後者覆蓋
import 'element-plus/dist/index.css'

// ─── Element Plus 圖標 ────────────────────────────────────────────
// 這個包含所有 Element Plus 圖標（Grid、Edit、ChatDotRound 等）
// 引入 * 是因為 SidebarNavItem.vue 需要根據配置字符串動態查找圖標組件
// 使用方式：ElementPlusIconsVue['Grid'] → Grid 組件
// 文件位置：node_modules/@element-plus/icons-vue
import * as ElementPlusIconsVue from '@element-plus/icons-vue'

// ─── 路由 ─────────────────────────────────────────────────────────
// 路由配置在 src/router/index.ts 定義
// 控制 URL → 組件的映射（哪個 URL 顯示哪個頁面）
import router from './router'

// ─── 根組件 ───────────────────────────────────────────────────────
// App.vue：所有頁面的父組件，負責初始化和事件監聽
// 整個應用的 Vue 組件樹從這裡開始
import App from './App.vue'

// ─── 全局樣式 ─────────────────────────────────────────────────────
// 必須在 element-plus/dist/index.css 之後引入！
// 原因：global.css 中用 :root { --el-color-primary: xxx } 覆蓋 Element Plus 的 CSS 變量
// 如果先引入 global.css，後引入的 element-plus 樣式會把變量重置回默認值
import './styles/global.css'

// ═══════════════════════════════════════════════════════════════════
// 啟動 Vue 應用
// ═══════════════════════════════════════════════════════════════════

// 第一步：用 App.vue 創建 Vue 應用實例
// App.vue 是根組件，所有其他組件都是它的子組件
const app = createApp(App)

// 第二步：注冊 Pinia（狀態管理）
// 必須在 router 之前注冊！
// 因為路由守衛可能需要訪問 Store（如 authStore.isAuthenticated）
const pinia = createPinia()
app.use(pinia)

// 第三步：注冊 Vue Router（路由）
// 注冊後，<router-view> 和 <router-link> 才能使用
// 注冊後，useRouter() 和 useRoute() 才能在組件中使用
app.use(router)

// 第四步：注冊 Element Plus
// locale 設置繁體中文，讓組件內部文字顯示正確
app.use(ElementPlus, {
  locale: zhTw,  // 繁體中文語言包（zh-tw = 台灣繁體中文）
})

// 第五步：全量注冊 Element Plus 圖標為全局組件
// 注冊後可以在任意模板中使用 <el-icon><Grid /></el-icon>
// 更重要的是：SidebarNavItem.vue 中的 <component :is="iconComponent" />
// 需要根據字符串名稱找到組件，必須先全局注冊才能找到
// 例：app.component('Grid', GridIcon) → 之後 <Grid /> 可以渲染
for (const [name, component] of Object.entries(ElementPlusIconsVue)) {
  // name = 'Grid'、'Edit'、'ChatDotRound' 等
  // component = 對應的 Vue 組件
  app.component(name, component)
}

// 第六步：掛載到 DOM
// '#app' 對應 src/index.html 中的 <div id="app"></div>
// 掛載後，App.vue 的模板替換這個 div，Vue 接管整個頁面
app.mount('#app')

// 第七步：啟用全局未捕獲異常 / Promise rejection 自動寫日誌
// 任何沒被 try/catch 的錯誤都會自動進 renderer-YYYY-MM-DD.log，
// 生產環境用戶遇到問題不需要打開 DevTools 也能還原現場
import { installGlobalErrorHandlers } from './utils/logger'
installGlobalErrorHandlers()
