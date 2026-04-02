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
</script>

<template>
  <div class="app-layout">
    <!-- 自定義標題欄（frameless 窗口，替代原生標題欄） -->
    <TitleBar />

    <!-- 主體區域：側邊欄 + 內容 -->
    <div class="app-body">
      <!-- 左側導航欄（config 驅動） -->
      <SidebarNav />

      <!-- 右側內容區：渲染子路由 -->
      <main class="app-content">
        <!--
          RouterView 過渡動畫：切換路由時淡入淡出
          keep-alive 保留已訪問的組件狀態（如 iframe 已加載的頁面）
        -->
        <router-view v-slot="{ Component, route }">
          <keep-alive>
            <component :is="Component" :key="route.fullPath" />
          </keep-alive>
        </router-view>
      </main>
    </div>
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
  background: var(--el-bg-color-page);
}

/* 主體區域：水平排列（側邊欄 + 內容） */
.app-body {
  display: flex;
  flex: 1;
  overflow: hidden;
  /* 去掉 TitleBar 的高度 */
  height: calc(100vh - 38px);
}

/* 右側內容區域 */
.app-content {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  background: var(--el-bg-color-page);
  /* 內容區需要正常滾動，不繼承 no-drag */
  -webkit-app-region: no-drag;
}

/* 自定義滾動條 */
.app-content::-webkit-scrollbar {
  width: 6px;
}

.app-content::-webkit-scrollbar-thumb {
  background: var(--el-border-color);
  border-radius: 3px;
}

.app-content::-webkit-scrollbar-thumb:hover {
  background: var(--el-border-color-darker);
}
</style>
