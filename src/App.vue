<script setup lang="ts">
/**
 * 主窗口根組件
 *
 * 職責：
 *  1. 應用初始化：掛載後加載配置和恢復登錄狀態
 *  2. 監聽主進程推送事件（窗口最大化狀態、配置變更）
 *  3. 提供全局佈局（通過 AppLayout 組件）
 *
 * 主進程推送事件（通過 preload 的 window.electronAPI.on）：
 *  - push:window-maximized  → 更新 uiStore.isMaximized，供 TitleBar 切換圖標
 *  - push:config-changed    → 重新加載配置（熱更新）
 *  - floating-ball:menu-action → 接收浮球菜單指令（目前由主進程轉發路由跳轉）
 *
 * 注意：
 *  - onUnmounted 清理事件監聽，避免重複注冊（HMR 場景）
 *  - 配置加載失敗時通過 ElMessage 提示，不阻塞渲染
 */

import { onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { useConfigStore } from '@/stores/config.store'
import { useAuthStore } from '@/stores/auth.store'
import { useUiStore } from '@/stores/ui.store'

const router = useRouter()
const configStore = useConfigStore()
const authStore = useAuthStore()
const uiStore = useUiStore()

// ── 主進程事件監聽器（保存引用以便清理） ─────────────────

/**
 * 窗口最大化/還原狀態推送
 * 主進程在 maximize/unmaximize 事件時發送
 * 參數用 unknown 接收再斷言，匹配 electronAPI.on 的簽名
 */
function onWindowMaximized(...args: unknown[]) {
  uiStore.setWindowMaximized(args[0] as boolean)
}

/**
 * 配置文件熱更新推送
 * 用戶在外部修改 app-config.json 後主進程推送此事件
 */
async function onConfigChanged(..._args: unknown[]) {
  try {
    await configStore.loadConfig()
    ElMessage.info('配置已更新')
  } catch {
    ElMessage.warning('配置重載失敗，使用舊配置')
  }
}

/**
 * 浮球菜單動作：navigate
 * 主進程收到浮球的 BALL_MENU_ACTION 後，轉發路由跳轉指令到主窗口
 */
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
    console.error('[App] 配置加載失敗:', err)
    ElMessage.error('應用配置加載失敗，部分功能可能不可用')
  }

  // 2. 嘗試從 OS 鑰匙串恢復登錄態（或開發環境自動登錄）
  try {
    await authStore.restoreSession()
  } catch (err) {
    console.warn('[App] 會話恢復失敗（可能未曾登錄）:', err)
  }

  // 3. 注冊主進程推送事件監聽
  window.electronAPI.on('push:window-maximized', onWindowMaximized)
  window.electronAPI.on('push:config-changed', onConfigChanged)
  window.electronAPI.on('floating-ball:navigate', onMenuNavigate)
})

onUnmounted(() => {
  // 清理事件監聽（防止 HMR 熱更新時重複注冊）
  window.electronAPI.off('push:window-maximized', onWindowMaximized)
  window.electronAPI.off('push:config-changed', onConfigChanged)
  window.electronAPI.off('floating-ball:navigate', onMenuNavigate)
})
</script>

<template>
  <!--
    App.vue 只負責初始化和事件監聽。
    佈局（TitleBar + SidebarNav + 內容區）由路由配置的 AppLayout 組件負責渲染。
    <router-view> 會根據當前路由渲染：
      - /login         → LoginView（無佈局）
      - /unified-platform 等 → AppLayout（含 TitleBar + SidebarNav + 子路由視圖）
  -->
  <router-view />
</template>
