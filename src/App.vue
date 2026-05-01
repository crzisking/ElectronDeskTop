<script setup lang="ts">
/**
 * 主窗口根組件。
 * 用於：應用初始化（載入 config、恢復登入態）+ 訂閱主進程推送事件。
 * 佈局由路由配置的 AppLayout 渲染，這裡只負責全局副作用。
 */

import { onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { useConfigStore } from '@/stores/config.store'
import { useAuthStore } from '@/stores/auth.store'
import { useUiStore } from '@/stores/ui.store'
import { useUpdate } from '@/composables/useUpdate'
import {logger} from "@/utils/logger";

const router = useRouter()
const configStore = useConfigStore()
const authStore = useAuthStore()
const uiStore = useUiStore()

// ── 主進程事件監聽器（保存引用以便 onUnmounted 清理） ─────────

/** 窗口最大化/還原狀態推送（主進程 maximize/unmaximize 事件） */
function onWindowMaximized(...args: unknown[]) {
  uiStore.setWindowMaximized(args[0] as boolean)
}

/** 配置文件熱更新：用戶在外部修改 app-config.json 後觸發 */
async function onConfigChanged(..._args: unknown[]) {
  try {
    await configStore.loadConfig()
    ElMessage.info('配置已更新')
  } catch {
    ElMessage.warning('配置重載失敗，使用舊配置')
  }
}

/** 浮球菜單跳轉指令：主進程接到 BALL_MENU_ACTION 後轉發路由名稱 */
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
  // 1. 加載應用配置（驅動側邊欄、浮球菜單等）
  try {
    await configStore.loadConfig()
  } catch (err) {
    logger.error('應用配置加載失敗，部分功能可能不可用', 'App.Vue', err)
    ElMessage.error('應用配置加載失敗，部分功能可能不可用')
  }

  // 2. 嘗試從 OS 鑰匙串恢復登錄態（或開發環境自動登錄）
  try {
    await authStore.restoreSession()
  } catch (err) {
    logger.warn('會話恢復失敗（可能未曾登錄）', 'App.Vue', err)
  }

  // 3. 注冊主進程推送事件監聽
  window.electronAPI.on('push:window-maximized', onWindowMaximized)
  window.electronAPI.on('push:config-changed', onConfigChanged)
  window.electronAPI.on('floating-ball:navigate', onMenuNavigate)

  // 4. 啟動自動更新監聽（訂閱 push:update-* 事件、處理通知/重啟確認）
  useUpdate().bootstrap()
})

onUnmounted(() => {
  // 清理事件監聽，避免 HMR 熱更新時重複注冊
  window.electronAPI.off('push:window-maximized', onWindowMaximized)
  window.electronAPI.off('push:config-changed', onConfigChanged)
  window.electronAPI.off('floating-ball:navigate', onMenuNavigate)
})
</script>

<template>
  <!-- 佈局由路由配置 AppLayout 渲染，這裡只是 router-view 出口 -->
  <router-view />
</template>
