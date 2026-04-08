/**
 * Vue Router 路由配置
 *
 * ── 什麼是 Vue Router？ ──────────────────────────────────────────────
 * Vue Router 是 Vue 3 官方路由庫，讓單頁應用（SPA）實現「多頁面」效果：
 *  - URL 變化時，不刷新整個頁面，只替換指定區域（<router-view>）的組件
 *  - 使用者感覺像在不同頁面間跳轉，實際上始終在同一個 HTML 文件中
 *
 * ── 路由結構樹 ──────────────────────────────────────────────────────
 * /login                    → LoginView（不需要認證，登錄頁）
 * /                         → 重定向到 /unified-platform
 * / (AppLayout 父路由)
 *   /unified-platform       → UnifiedPlatformView（統一平台）
 *   /ai-quick-functions     → AiQuickFunctionsView（AI 快捷功能）
 *   /business               → BusinessView（業務安排與尋找）
 * /:pathMatch(.*)*          → 所有未知路由重定向到 /unified-platform（404 處理）
 *
 * ── 父子路由嵌套原理 ─────────────────────────────────────────────────
 * AppLayout 是「父路由」，它的組件模板中有一個 <router-view>：
 *   // AppLayout.vue 的模板簡化示意：
 *   <template>
 *     <div class="app-layout">
 *       <TitleBar />             ← 所有子頁面共用的頂部標題欄
 *       <SidebarNav />           ← 所有子頁面共用的左側導航欄
 *       <main>
 *         <router-view />        ← 子路由的組件渲染在這裡
 *       </main>
 *     </div>
 *   </template>
 * 訪問 /unified-platform 時：
 *   外層 <router-view>（在 App.vue 中）渲染 AppLayout
 *   AppLayout 內層 <router-view> 渲染 UnifiedPlatformView
 * 好處：TitleBar 和 SidebarNav 不需要在每個頁面重複寫，統一在父路由中管理。
 *
 * ── 路由守衛 ────────────────────────────────────────────────────────
 * 目前認證守衛已注釋（登錄功能未實現）
 * 預留位置清晰可見，登錄功能完成後取消注釋即可
 */

// ── import 說明 ──────────────────────────────────────────────────────
// createRouter：Vue Router 提供的工廠函數，創建路由器實例
// createWebHashHistory：創建「Hash 模式」的路由歷史記錄管理器
//   URL 格式：http://localhost/#/unified-platform
//   （# 號後面的部分是 hash，不會發送到服務器）
//
// ── 為什麼用 createWebHashHistory 而不用 createWebHistory？ ──────────
// createWebHistory（HTML5 History 模式）的 URL 格式：
//   http://localhost/unified-platform（沒有 # 號，看起來更「正常」）
// 但它依賴服務器的「URL 重寫」：
//   當直接訪問 /unified-platform 時，服務器必須返回 index.html 而不是 404
//   在 Nginx/Apache 中需要配置 try_files $uri /index.html
//
// Electron 加載的是本地文件，URL 格式類似：
//   file:///C:/Users/Admin/app/dist/index.html
// 當路由跳轉到 /unified-platform 後，如果刷新，Electron 會嘗試加載：
//   file:///C:/Users/Admin/app/dist/unified-platform（這個文件不存在！→ 空白頁）
//
// Hash 模式下，URL 變為：
//   file:///C:/Users/Admin/app/dist/index.html#/unified-platform
// 路由路徑在 # 號之後，Electron/瀏覽器始終加載 index.html，
// 路由由 Vue Router 在客戶端解析，完全繞開了服務器/文件系統的問題。
//
// 結論：Electron 本地文件環境 → 必須用 Hash 模式
//
// 來源：vue-router 套件
import { createRouter, createWebHashHistory } from 'vue-router'

// RouteRecordRaw：路由配置對象的 TypeScript 類型（Raw = 原始/配置態）
//   規定了每個路由必須有哪些字段（path、component 等）
//   以及可以有哪些可選字段（name、meta、children 等）
//   import type 表示只導入類型定義，不會出現在編譯後的 JS 中
//   來源：vue-router 套件
import type { RouteRecordRaw } from 'vue-router'

// ═══════════════════════════════════════════════════════════════════
// 路由配置數組
// RouteRecordRaw[] 表示「RouteRecordRaw 類型的數組」
// ═══════════════════════════════════════════════════════════════════

/**
 * 路由定義數組
 *
 * ── () => import('@/views/...') 懶加載說明 ─────────────────────────
 * 如果寫成：component: LoginView（直接導入組件）
 *   → 所有頁面組件在應用啟動時全部加載，初始包大小很大，首屏慢
 *
 * 如果寫成：component: () => import('@/views/Login/LoginView.vue')
 *   → 只有用戶真正訪問這個路由時，才去下載/加載對應的 JS 模塊
 *   → 初始包只包含核心代碼，其他頁面按需加載
 *   → 在 Vite 打包時，每個懶加載的組件會被拆分成獨立的 chunk 文件
 *
 * 在 Electron 本地文件場景中，雖然沒有網絡延遲問題，
 * 懶加載仍然有助於加快應用啟動速度（解析 JS 也需要時間）。
 */
const routes: RouteRecordRaw[] = [

  // ── 默認重定向 ──────────────────────────────────────────────────
  // 訪問根路徑 / 時，自動跳轉到 /unified-platform
  // redirect 字段：值可以是字符串路徑，或 { name: 'route-name' }
  // 這個路由本身不渲染任何組件，只做跳轉
  {
    path: '/',
    redirect: '/unified-platform'
  },

  // ── 登錄頁（預留，功能待實現）────────────────────────────────────
  // 不需要認證的「公開頁面」，任何人都可以訪問
  {
    path: '/login',          // URL 路徑：http://app/#/login
    name: 'login',           // 路由命名，用於 router.push({ name: 'login' }) 跳轉
                             // 比使用路徑字符串更安全（路徑改變不影響代碼）

    // 懶加載：只有用戶訪問 /login 時才加載 LoginView.vue 的代碼
    // @/views/Login/LoginView.vue → src/views/Login/LoginView.vue
    component: () => import('@/views/Login/LoginView.vue'),

    // meta：路由元信息，可以存任意自定義數據
    // 在路由守衛中通過 to.meta.requiresAuth 讀取
    meta: {
      requiresAuth: false,   // false = 不需要登錄就能訪問（公開頁面）
      title: '登錄'           // 頁面標題，在路由守衛中用於更新 document.title
    }
  },

  // ── 需要認證的頁面群組（AppLayout 作為父路由）───────────────────
  // 這個路由對象本身的 path 是 '/'，但它的作用是「提供共用佈局」
  // AppLayout 組件中有 <router-view>，子路由組件渲染在那個位置
  {
    path: '/',
    // 父路由組件：AppLayout 包含 TitleBar + SidebarNav + <router-view>
    // 訪問任何子路由時，AppLayout 都會保持在頁面上（不重新掛載）
    component: () => import('@/components/layout/AppLayout.vue'),
    meta: { requiresAuth: true },  // 整組子路由都需要認證（子路由可繼承）

    // children 數組：所有子路由配置
    // 子路由的 path 不需要以 / 開頭（相對路徑）
    // 最終 URL = 父路由 path + '/' + 子路由 path
    children: [

      // ── 統一平台（默認首頁）──────────────────────────────────────
      // 完整 URL：http://app/#/unified-platform
      // 渲染位置：AppLayout 模板內的 <router-view>
      {
        path: 'unified-platform',           // 相對路徑（父路徑 / + unified-platform）
        name: 'unified-platform',           // 命名路由
        component: () => import('@/views/UnifiedPlatform/UnifiedPlatformView.vue'),
        meta: {
          requiresAuth: true,               // 需要登錄
          title: '統一平台'                  // document.title 顯示「統一平台 - 企業桌面客戶端」
        }
      },

      // ── AI 快捷功能 ──────────────────────────────────────────────
      // 完整 URL：http://app/#/ai-quick-functions
      // 這個頁面提供多個 AI 工具的入口（由 uiStore.activeAiTool 控制激活的 Tab）
      {
        path: 'ai-quick-functions',
        name: 'ai-quick-functions',
        component: () => import('@/views/AiQuickFunctions/AiQuickFunctionsView.vue'),
        meta: {
          requiresAuth: true,
          title: 'AI 快捷功能'
        }
      },

      // ── 業務安排與尋找 ──────────────────────────────────────────
      // 完整 URL：http://app/#/business
      // 提供業務流水線維護（X6 流程圖）和業務負責人查找功能
      {
        path: 'business',
        name: 'business',
        component: () => import('@/views/Business/BusinessView.vue'),
        meta: {
          requiresAuth: true,
          title: '業務安排與尋找'
        }
      }
    ]
  },

  // ── 404 處理（通配符重定向）────────────────────────────────────
  // :pathMatch(.*)* 是 Vue Router 4 的通配符語法，匹配所有未定義路由
  // 例如訪問 /#/some-undefined-page → 重定向到 /unified-platform
  // 這個路由必須放在最後，因為路由是按順序匹配的
  {
    path: '/:pathMatch(.*)*',
    redirect: '/unified-platform'
  }
]

// ═══════════════════════════════════════════════════════════════════
// 路由器實例創建
// ═══════════════════════════════════════════════════════════════════

/**
 * 路由器實例
 *
 * createRouter 的配置：
 *  history：路由歷史記錄策略（決定 URL 的格式和行為）
 *    createWebHashHistory() → Hash 模式，URL 帶 # 號
 *    原因見上方 import 說明
 *  routes：路由配置數組（就是上面定義的 routes 常量）
 *
 * 這個 router 實例會在 src/main.ts 中通過 app.use(router) 安裝到 Vue 應用中，
 * 之後所有組件都可以使用 useRouter() 和 useRoute() 訪問路由功能。
 */
const router = createRouter({
  history: createWebHashHistory(),
  routes
})

// ═══════════════════════════════════════════════════════════════════
// 全局路由守衛（Navigation Guards）
// 路由守衛是「路由跳轉的攔截器」，在真正跳轉前執行
// ═══════════════════════════════════════════════════════════════════

/**
 * beforeEach：全局前置守衛
 *
 * 每次路由跳轉前都會執行此函數（包括應用首次加載）。
 *
 * 參數：
 *  to   ：即將要進入的目標路由（RouteLocationNormalized 類型）
 *         包含 path、name、params、query、meta 等信息
 *  _from：正在離開的當前路由（前綴 _ 表示此參數暫時不使用）
 *
 * 返回值決定守衛行為：
 *  undefined / true：允許跳轉，繼續導航
 *  false           ：取消跳轉，留在當前路由
 *  { name: '...' }：跳轉到另一個路由（重定向）
 *
 * ── meta.requiresAuth 的預留說明 ─────────────────────────────────
 * 每個路由的 meta.requiresAuth 字段標記「是否需要登錄」：
 *   true  → 未登錄用戶不能訪問，要重定向到 /login
 *   false → 公開頁面，任何人都可以訪問
 * 當認證守衛取消注釋後，這些字段就會生效：
 *   if (to.meta.requiresAuth && !authStore.isAuthenticated) {
 *     return { name: 'login' }   // 未登錄 → 強制跳到登錄頁
 *   }
 * 目前守衛代碼被注釋掉，所以 requiresAuth 字段暫時沒有實際效果，
 * 但保留它是好的實踐：等登錄功能實現後，守衛立即就能工作。
 */
router.beforeEach((to, _from) => {
  // ── 更新瀏覽器/窗口標題 ────────────────────────────────────────
  // to.meta.title 是在路由配置中設置的自定義標題字符串
  // 使用 as string | undefined 進行類型斷言（meta 字段默認類型是 unknown）
  const title = to.meta.title as string | undefined
  if (title) {
    // document.title 直接設置瀏覽器/Electron 窗口的標題欄文字
    // 格式：「統一平台 - 企業桌面客戶端」
    document.title = `${title} - 企業桌面客戶端`
  }

  // ─────────────────────────────────────────────────────────────────
  // TODO: 登錄功能實現後，取消下方注釋以啟用認證守衛
  //
  // 取消注釋前需要先在文件頂部添加以下 import：
  //   import { useAuthStore } from '@/stores/auth.store'
  //
  // 認證守衛邏輯：
  // ─────────────────────────────────────────────────────────────────
  // const authStore = useAuthStore()
  //
  // // 情況1：需要認證 && 用戶未登錄 → 強制跳轉到登錄頁
  // // to.meta.requiresAuth 讀取路由配置中的 meta 字段
  // // authStore.isAuthenticated 讀取 auth.store.ts 中的響應式狀態
  // if (to.meta.requiresAuth && !authStore.isAuthenticated) {
  //   return { name: 'login' }   // 返回路由對象 = 重定向
  // }
  //
  // // 情況2：用戶已登錄 && 嘗試訪問登錄頁 → 跳轉到首頁（避免已登錄還看到登錄頁）
  // if (to.name === 'login' && authStore.isAuthenticated) {
  //   return { name: 'unified-platform' }
  // }
  //
  // // 以上兩個 if 都不觸發時，函數返回 undefined = 允許正常跳轉
  // ─────────────────────────────────────────────────────────────────
})

// 導出 router 實例供 src/main.ts 使用：
//   import router from '@/router'
//   app.use(router)  // 安裝路由插件到 Vue 應用
export default router
