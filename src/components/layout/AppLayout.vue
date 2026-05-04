<script setup lang="ts">
/**
 * 主應用佈局組件
 *
 * 整體佈局結構（垂直方向）：
 *  ┌──────────────────────────────────┐
 *  │         TitleBar（38px）          │
 *  ├──────────┬───────────────────────┤
 *  │          │                       │
 *  │ Sidebar  │    RouterView（主內容）│
 *  │          │                       │
 *  └──────────┴───────────────────────┘
 *
 * 作為所有需要認證的路由的父佈局（嵌套路由）。
 * 子路由通過 <router-view> 渲染在右側內容區。
 */

import TitleBar from './TitleBar.vue'
import SidebarNav from './SidebarNav.vue'
import LoadingSpinner from '@/components/common/LoadingSpinner.vue'
import {useUiStore} from '@/stores/ui.store'

const uiStore = useUiStore()
</script>

<template>
  <div class="app-layout">
    <!-- 全屏初始化加載遮罩：配置載入、會話恢復期間顯示 -->
    <LoadingSpinner v-if="uiStore.globalLoading" fullscreen text="應用初始化中..."/>

    <template v-else>
    <!-- 自定義標題欄（frameless 窗口，替代原生標題欄） -->
    <TitleBar/>

    <!-- 主體區域：側邊欄 + 內容 -->
    <div class="app-body">
      <!-- 左側導航欄（config 驅動） -->
      <SidebarNav/>

      <!-- 右側內容區：渲染子路由 -->
      <main class="app-content">
        <!--
          RouterView 過渡動畫：切換路由時淡入淡出
          keep-alive 保留已訪問的組件狀態（如 iframe 已加載的頁面）
        -->
        <router-view />
      </main>
    </div>
    </template>
  </div>
</template>

<style scoped>
/* 全屏佈局容器（填充整個窗口） */
.app-layout {
  display: flex;
  flex-direction: column;
  height: 100vh;
  width: 100vw;
  overflow: hidden;
  background: var(--app-bg-canvas);
}

/* 主體區域：水平排列（側邊欄 + 內容） */
.app-body {
  display: flex;
  flex: 1;
  overflow: hidden;
  height: calc(100vh - var(--titlebar-height));
  padding: 12px;
  gap: 12px;
}

/* 右側內容區域：白色卡片化的主舞台 */
.app-content {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  background: var(--app-bg-surface);
  border-radius: var(--app-radius-lg);
  border: 1px solid var(--app-border-subtle);
  box-shadow: var(--app-shadow-sm);
  -webkit-app-region: no-drag;
  /* 滾動條樣式統一在 global.css 全局定義（::-webkit-scrollbar），此處不再重複 */
}
</style>
