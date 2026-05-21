import type {RouteRecordRaw} from 'vue-router'
import {createRouter, createWebHashHistory} from 'vue-router'
import {useAuthStore} from '@/stores/auth.store'
import {useConfigStore} from '@/stores/config.store'
import {i18n} from '@/locales'

/**
 * 應用路由表。
 * 用於：main.ts 的 app.use(router) 注冊；組件透過 useRouter/useRoute 使用。
 * 所有頁面組件採懶加載（() => import），加快啟動 JS 解析速度。
 */
const routes: RouteRecordRaw[] = [

  // 根路徑重定向到統一平台首頁
  {
    path: '/',
    redirect: '/unified-platform'
  },

  // 登錄頁（不需認證的公開頁面）
  // meta.title 改存「i18n key」，在 beforeEach 動態解析；原文：登錄
  {
    path: '/login',
    name: 'login',
    component: () => import('@/views/Login/LoginView.vue'),
    meta: {
      requiresAuth: false,
      title: 'router.login'
    }
  },

  // 需要認證的頁面群組：以 AppLayout 為共用父佈局（TitleBar + SidebarNav + <router-view>）
  {
    path: '/',
    component: () => import('@/components/layout/AppLayout.vue'),
    meta: { requiresAuth: true },
    children: [

      // 統一平台（默認首頁）；原文 title：統一平台
      {
        path: 'unified-platform',
        name: 'unified-platform',
        component: () => import('@/views/UnifiedPlatform/UnifiedPlatformView.vue'),
        meta: {
          requiresAuth: true,
          title: 'router.unifiedPlatform'
        }
      },

      // 內部功能入口；原文 title：內部功能
      {
        path: 'internal-functions',
        name: 'internal-functions',
        component: () => import('@/views/InternalFunctions/InternalFunctionsView.vue'),
        meta: {
          requiresAuth: true,
          title: 'router.internalFunctions'
        }
      },

      // BPM 負責人查詢；原文 title：BPM 負責人查詢
      {
        path: 'ai-bpm-finder',
        name: 'ai-bpm-finder',
        component: () => import('@/views/InternalFunctions/child/BpmFinderView.vue'),
        meta: {
          requiresAuth: true,
          title: 'router.bpmFinder'
        }
      },

      // IT 報修；原文 title：IT 報修
      {
        path: 'it-repair',
        name: 'it-repair',
        component: () => import('@/views/InternalFunctions/child/ITRepair/ITRepairView.vue'),
        meta: {
          requiresAuth: true,
          title: 'router.itRepair'
        }
      },

      // AiSop；title 為產品名直接保留（不翻）
      {
        path: 'ai-sop',
        name: 'ai-sop',
        component: () => import('@/views/InternalFunctions/child/AiSop/AiSopView.vue'),
        meta: {
          requiresAuth: true,
          title: 'router.aiSop'
        }
      },

      // 工作自動採集 — 內部用,定時截圖 → 後端 AI 分析 → 流水線
      {
        path: 'work-collect',
        name: 'work-collect',
        component: () => import('@/views/InternalFunctions/child/WorkCollect/WorkCollectView.vue'),
        meta: {
          requiresAuth: true,
          title: 'router.workCollect'
        }
      }

    ]
  },

  // 通配符兜底：未定義路由全部重定向到首頁（必須放最後）
  {
    path: '/:pathMatch(.*)*',
    redirect: '/unified-platform'
  }
]

/**
 * 路由器實例。
 * 用 hash history（URL 帶 #）：Electron 載入本地 file:// 時不需要伺服器 rewrite。
 */
const router = createRouter({
  history: createWebHashHistory(),
  routes
})

/**
 * 全局前置守衛：更新標題 + 認證攔截。
 * 用於：每次路由跳轉前判斷是否放行（含應用首次加載）。
 * 注意：main.ts 中 pinia 先於 router 注冊，故此處 useAuthStore 安全。
 */
router.beforeEach((to, _from) => {
  // 更新窗口標題：meta.title 是 i18n key，動態解析後拼上應用名
  // 原文後綴：- 企業桌面客戶端
  const titleKey = to.meta.title as string | undefined
  if (titleKey) {
    const pageTitle = i18n.global.t(titleKey)
    const appName = i18n.global.t('app.name')
    document.title = `${pageTitle} - ${appName}`
  }

  const authStore = useAuthStore()
  const configStore = useConfigStore()

  // 配置未加載完成 → 先放行，待 App.vue loadConfig 完成後重新觸發守衛
  if (!configStore.isLoaded) return

  // 需要認證但未登入 → 跳轉登錄頁
  if (to.meta.requiresAuth && !authStore.isAuthenticated) {
    return { name: 'login' }
  }

  // 已登入卻訪問登錄頁 → 跳回首頁
  if (to.name === 'login' && authStore.isAuthenticated) {
    return { name: 'unified-platform' }
  }
})

export default router
