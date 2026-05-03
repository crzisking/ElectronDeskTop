import type {RouteRecordRaw} from 'vue-router'
import {createRouter, createWebHashHistory} from 'vue-router'
import {useAuthStore} from '@/stores/auth.store'

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
  {
    path: '/login',
    name: 'login',
    component: () => import('@/views/Login/LoginView.vue'),
    meta: {
      requiresAuth: false,
      title: '登錄'
    }
  },

  // 需要認證的頁面群組：以 AppLayout 為共用父佈局（TitleBar + SidebarNav + <router-view>）
  {
    path: '/',
    component: () => import('@/components/layout/AppLayout.vue'),
    meta: { requiresAuth: true },
    children: [

      // 統一平台（默認首頁）
      {
        path: 'unified-platform',
        name: 'unified-platform',
        component: () => import('@/views/UnifiedPlatform/UnifiedPlatformView.vue'),
        meta: {
          requiresAuth: true,
          title: '統一平台'
        }
      },

      // 內部功能入口：同時放 AI 工具與公司內部功能，由 config 驅動
      {
        path: 'internal-functions',
        name: 'internal-functions',
        component: () => import('@/views/InternalFunctions/InternalFunctionsView.vue'),
        meta: {
          requiresAuth: true,
          title: '內部功能'
        }
      },

      // BPM 負責人查詢：嵌入 Dify chatbot，URL 由 app-config.json 管理
      {
        path: 'ai-bpm-finder',
        name: 'ai-bpm-finder',
        component: () => import('@/views/InternalFunctions/child/BpmFinderView.vue'),
        meta: {
          requiresAuth: true,
          title: 'BPM 負責人查詢'
        }
      },

      // IT 報修工單：用戶提交設備故障 / 查看自己的工單狀態
      {
        path: 'it-repair',
        name: 'it-repair',
        component: () => import('@/views/InternalFunctions/child/ITRepair/ITRepairView.vue'),
        meta: {
          requiresAuth: true,
          title: 'IT 報修'
        }
      },

      // AiSop：AI 標準作業流程查詢
      {
        path: 'ai-sop',
        name: 'ai-sop',
        component: () => import('@/views/InternalFunctions/child/AiSop/AiSopView.vue'),
        meta: {
          requiresAuth: true,
          title: 'AiSop'
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
  // 更新窗口標題
  const title = to.meta.title as string | undefined
  if (title) {
    document.title = `${title} - 企業桌面客戶端`
  }

  const authStore = useAuthStore()

  // restoreSession 進行中不做攔截，等其完成後再判斷
  if (authStore.isRestoringSession) return

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
