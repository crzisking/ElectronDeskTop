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
import {useUpdate} from '@/composables/useUpdate'
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

  // 2. 嘗試 AD 自動登入（Windows 本機帳號 → 後端換 JWT → 寫入 store）。
  //    成功:後續守衛通過 requiresAuth,直接進原本 initialTarget。
  //    失敗:authStore 未認證,守衛把它導去 /login,使用者手動輸帳號密碼。
  //    刻意不阻塞 await:這支是「能成功就好」的旁路;
  //    若超時或網路慢,寧可走手動登入也不要卡白屏。
  if (!authStore.isAuthenticated) {
    await authStore.loginByAd().catch((err) => {
      logger.warn('AD 自動登入流程異常', 'App.Vue', err)
      return false
    })
  }

  // 3. 配置就緒後重新觸發守衛，讓路由按真實 auth 狀態決定
  await router.replace(initialTarget).catch(() => undefined)

  // 4. 注冊主進程推送事件監聽
  window.electronAPI.on(IpcChannels.PUSH_WINDOW_MAXIMIZED, onWindowMaximized)
  window.electronAPI.on(IpcChannels.PUSH_CONFIG_CHANGED, onConfigChanged)
  window.electronAPI.on(IpcChannels.PUSH_BALL_NAVIGATE, onMenuNavigate)

  // 5. 啟動自動更新監聽（訂閱 push:update-* 事件、處理通知/重啟確認）
  useUpdate().bootstrap()

  // 6. 初始化完成,隱藏全屏加載遮罩
  uiStore.hideGlobalLoading()
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
