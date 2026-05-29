<script setup lang="ts">
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
import {logger} from "@/utils/logger";
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
    router.push({ name: routeName }).catch(() => {
      // 路由不存在時靜默忽略
    })
  }
}

// ── 生命週期 ──────────────────────────────────────────

onMounted(async () => {
  // 啟動期目標路由
  const initialTarget = router.currentRoute.value.fullPath

  // 1. 加載配置（Token 不持久化，無需恢復會話）
  try {
    await configStore.loadConfig()

    // 配置就緒後立刻矯正 i18n locale —— main.ts 啟動時用 'zh-TW' 兜底，
    // 真實語言偏好存在 config.app.language，這裡讀出來同步到 i18n
    const lang = configStore.appConfig?.app.language
    if (isSupportedLocale(lang)) {
      setLocale(lang)
    }
  } catch (err) {
    // 應用配置加載失敗，部分功能可能不可用
    logger.error(t('app.configLoadFailed'), 'App.Vue', err)
    ElMessage.error(t('app.configLoadFailed'))
  }

  // 步驟 2-6 用 try/finally 包住:任一步同步 throw(bootstrap / update / 訂閱)
  // 都不能讓 hideGlobalLoading 漏掉,否則卡在全屏 loading 白屏。
  try {
    // 2. 嘗試 AD 自動登入（Windows 本機帳號 → 後端換 JWT → 寫入 store）。
    //    失敗:authStore 未認證,守衛導去 /login 手動登入。不阻塞,寧可手動也別卡白屏。
    if (!authStore.isAuthenticated) {
      await authStore.loginByAd().catch((err) => {
        logger.warn('AD 自動登入流程異常', 'App.Vue', err)
        return false
      })
    }

    // 3. 依 auth 狀態決定最終路由(沒登入 replace 去 /login,guard 會跑)
    if (!authStore.isAuthenticated) {
      await router.replace({name: 'login'}).catch(() => undefined)
    } else {
      // AD 登入成功 → 同步使用者身份(不 await,store 內已 catch);表單登入由 LoginView 自己同步
      void useUserProfileStore().syncAfterLogin()
      await router.replace(initialTarget).catch(() => undefined)
    }

    // 4. 注冊主進程推送事件監聽
    window.electronAPI.on(IpcChannels.PUSH_WINDOW_MAXIMIZED, onWindowMaximized)
    window.electronAPI.on(IpcChannels.PUSH_CONFIG_CHANGED, onConfigChanged)
    window.electronAPI.on(IpcChannels.PUSH_BALL_NAVIGATE, onMenuNavigate)

    // 4.1 訂閱工作採集事件。必須在 App level 訂,否則 scheduler tick 推來時沒人接。
    useWorkCollectStore().bootstrap()

    // 5. 啟動自動更新監聽（訂閱 push:update-* 事件）
    const update = useUpdate()
    update.bootstrap()

    // 5.1 AD 免密登入繞過 LoginView,在此補一次靜默檢查更新(須在 bootstrap 之後)
    if (authStore.isAuthenticated) {
      void update.loginCheck()
    }
  } catch (err) {
    logger.error('App 初始化異常', 'App.Vue', err)
  } finally {
    // 6. 無論成功 / 異常都要關掉全屏 loading
    uiStore.hideGlobalLoading()
  }
})

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
    <router-view />
  </el-config-provider>
</template>
