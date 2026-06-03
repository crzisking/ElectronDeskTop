<script lang="ts" setup>
/**
 * 主窗口根組件。
 * 用於：應用初始化（載入 config、恢復登入態）+ 訂閱主進程推送事件。
 * 佈局由路由配置的 AppLayout 渲染，這裡只負責全局副作用。
 */

import {computed, onMounted, onUnmounted} from 'vue'
import {useRouter} from 'vue-router'
import {ElMessage} from 'element-plus'
import {useI18n} from 'vue-i18n'
import {useConfigStore} from '@/stores/config.store'
import {useUiStore} from '@/stores/ui.store'
import {useAuthStore} from '@/stores/auth.store'
import {useWorkCollectStore} from '@/features/work-collect/store'
import {useUserProfileStore} from '@/features/user-profile/store'
import {useUpdate} from '@/features/update/use-update'
import {getElementLocale, isSupportedLocale, setLocale, type SupportedLocale} from '@/locales'
import {logger} from "@/shared/utils/logger";
import {IpcChannels} from '@shared/ipc-channels'

const router = useRouter()
const configStore = useConfigStore()
const uiStore = useUiStore()
const authStore = useAuthStore()
const {t, locale} = useI18n()

/**
 * 響應式 Element Plus locale —— 跟隨 i18n 當前語言切換。
 * <el-config-provider> 接這個 prop，讓 Element Plus 內建組件文案
 * （ElDatePicker、ElPagination 等）自動跟主應用同步。
 */
const elementLocale = computed(() => getElementLocale(locale.value as SupportedLocale))

// ── 主進程事件監聽器（保存引用以便 onUnmounted 清理） ─────────

/** 窗口最大化/還原狀態推送（主進程 maximize/unmaximize 事件） */
function onWindowMaximized(...args: unknown[]) {
  uiStore.setWindowMaximized(args[0] as boolean)
}

/** 配置文件熱更新：用戶在外部修改 app-config.json 後觸發 */
async function onConfigChanged(..._args: unknown[]) {
  try {
    await configStore.loadConfig()
    // 配置已更新
    ElMessage.info(t('app.configUpdated'))
  } catch {
    // 配置重載失敗，使用舊配置
    ElMessage.warning(t('app.configReloadFailed'))
  }
}

/** 浮球/托盤菜單跳轉指令：主進程透過 PUSH_BALL_NAVIGATE 推送路由名稱 */
function onMenuNavigate(...args: unknown[]) {
  const routeName = args[0] as string
  if (routeName) {
    router.push({name: routeName}).catch(() => {
      // 路由不存在時靜默忽略
    })
  }
}

// ── 生命週期 ──────────────────────────────────────────

/**
 * 啟動流程分兩階段:
 *   critical    阻塞全屏 loading — 配置 + AD 登入 + 路由(沒這些頁面無法渲染)
 *   background  fire-and-forget — IPC 訂閱、自動更新、使用者資料同步(失敗只 log,
 *               不該卡白屏。例如 AD / update fetch 卡住或 throw,使用者也應該能進主畫面)
 *
 * 任一階段內部各步都包了 try-catch,單點失敗不會擴散,hideGlobalLoading 永遠會跑。
 */
onMounted(async () => {
  const initialTarget = router.currentRoute.value.fullPath
  try {
    await initCritical(initialTarget)
  } catch (err) {
    logger.error('App critical init 異常', 'App.Vue', err)
  } finally {
    // critical 不管成功失敗都要收 loading,讓使用者至少看到 login / 錯誤頁,不卡白屏
    uiStore.hideGlobalLoading()
  }
  initBackground()
})

/** 必須完成才能 hideLoading 的步驟 */
async function initCritical(initialTarget: string): Promise<void> {
  // 1. 配置 + i18n locale 矯正(配置決定 sidebar / 路由 meta,必先就緒)
  try {
    await configStore.loadConfig()
    const lang = configStore.appConfig?.app.language
    if (isSupportedLocale(lang)) setLocale(lang)
  } catch (err) {
    logger.error(t('app.configLoadFailed'), 'App.Vue', err)
    ElMessage.error(t('app.configLoadFailed'))
    // 配置失敗仍繼續走,讓使用者進得了 /login,不徹底卡死
  }

  // 2. AD 自動登入(失敗不拋 — 守衛會導去 /login 手動登入,寧可手動也別卡)
  if (!authStore.isAuthenticated) {
    await authStore.loginByAd().catch((err) => {
      logger.warn('AD 自動登入流程異常', 'App.Vue', err)
      return false
    })
  }

  // 3. 依 auth 狀態決定最終路由
  if (!authStore.isAuthenticated) {
    await router.replace({name: 'login'}).catch(() => undefined)
  } else {
    await router.replace(initialTarget).catch(() => undefined)
  }
}

/**
 * 非關鍵步驟:背景跑,失敗只 log。
 * 不 await — 呼叫端不需等這裡完成;每段獨立 try,單一拋出不影響其他段。
 */
function initBackground(): void {
  // 4. 註冊主進程推送事件監聽
  try {
    window.electronAPI.on(IpcChannels.PUSH_WINDOW_MAXIMIZED, onWindowMaximized)
    window.electronAPI.on(IpcChannels.PUSH_CONFIG_CHANGED, onConfigChanged)
    window.electronAPI.on(IpcChannels.PUSH_BALL_NAVIGATE, onMenuNavigate)
  } catch (err) {
    logger.warn('註冊 IPC 監聽異常', 'App.Vue', err)
  }

  // 5. 工作採集訂閱(scheduler tick 推來時要有人接;只是註冊監聽不打網路)
  try {
    useWorkCollectStore().bootstrap()
  } catch (err) {
    logger.warn('work-collect bootstrap 異常', 'App.Vue', err)
  }

  // 6. 自動更新監聽 + AD 免密登入後的補一次靜默檢查
  try {
    const update = useUpdate()
    update.bootstrap()
    if (authStore.isAuthenticated) {
      void update.loginCheck().catch((err) => logger.warn('update.loginCheck 異常', 'App.Vue', err))
    }
  } catch (err) {
    logger.warn('update bootstrap 異常', 'App.Vue', err)
  }

  // 7. 已登入者非同步同步 user profile(LoginView 走表單登入會自己同步,這裡兜 AD / token 還在的場景)
  if (authStore.isAuthenticated) {
    void useUserProfileStore().syncAfterLogin()
  }
}

onUnmounted(() => {
  // 清理事件監聽，避免 HMR 熱更新時重複注冊
  window.electronAPI.off(IpcChannels.PUSH_WINDOW_MAXIMIZED, onWindowMaximized)
  window.electronAPI.off(IpcChannels.PUSH_CONFIG_CHANGED, onConfigChanged)
  window.electronAPI.off(IpcChannels.PUSH_BALL_NAVIGATE, onMenuNavigate)
})
</script>

<template>
  <!-- el-config-provider 把 Element Plus 內建組件文案綁到響應式 locale，
       語言切換後 ElDatePicker / ElPagination 等自動跟著變 -->
  <el-config-provider :locale="elementLocale">
    <!-- 佈局由路由配置 AppLayout 渲染，這裡只是 router-view 出口 -->
    <router-view/>
  </el-config-provider>
</template>
