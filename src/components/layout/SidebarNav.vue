<script setup lang="ts">
/**
 * 左側邊欄導航組件
 *
 * 完全由 config-driven：菜單項從 configStore.sidebarItems 讀取，
 * 不在代碼中硬編碼任何菜單。
 *
 * 功能：
 *  - 頂部 Logo 區域
 *  - 菜單項列表（v-for configStore.sidebarItems）
 *  - 底部折疊/展開切換按鈕
 *  - 折疊時寬度收窄，只顯示圖標（帶 tooltip）
 */

import { computed } from 'vue'
import { useConfigStore } from '@/stores/config.store'
import { useUiStore } from '@/stores/ui.store'
import SidebarNavItem from './SidebarNavItem.vue'
import { Fold, Expand } from '@element-plus/icons-vue'

const configStore = useConfigStore()
const uiStore = useUiStore()

/** 從 configStore 讀取啟用的菜單項（自動過濾 enabled: false） */
const navItems = computed(() => configStore.sidebarItems)

/** 當前是否折疊 */
const collapsed = computed(() => uiStore.sidebarCollapsed)

/** 切換折疊狀態 */
function toggleCollapse() {
  uiStore.toggleSidebar()
}
</script>

<template>
  <aside class="sidebar" :class="{ 'sidebar--collapsed': collapsed }">
    <!-- 頂部 Logo 區域（折疊時只顯示圖標） -->
    <div class="sidebar-logo">
      <div class="logo-icon">企</div>
      <span v-show="!collapsed" class="logo-text">企業客戶端</span>
    </div>

    <el-divider style="margin: 0; border-color: var(--el-border-color-lighter)" />

    <!-- 導航菜單列表 -->
    <nav class="sidebar-nav" role="menu" aria-label="主導航">
      <SidebarNavItem
        v-for="item in navItems"
        :key="item.id"
        :item="item"
        :collapsed="collapsed"
      />

      <!-- 無菜單項時的提示 -->
      <div v-if="navItems.length === 0" class="nav-empty">
        <el-text type="info" size="small">菜單配置為空</el-text>
      </div>
    </nav>

    <!-- 底部折疊/展開按鈕 -->
    <div class="sidebar-footer">
      <el-divider style="margin: 0 0 8px; border-color: var(--el-border-color-lighter)" />
      <button
        class="collapse-btn"
        :title="collapsed ? '展開側邊欄' : '折疊側邊欄'"
        @click="toggleCollapse"
      >
        <el-icon :size="16">
          <Expand v-if="collapsed" />
          <Fold v-else />
        </el-icon>
        <span v-show="!collapsed" class="collapse-text">折疊</span>
      </button>
    </div>
  </aside>
</template>

<style scoped>
.sidebar {
  display: flex;
  flex-direction: column;
  width: 220px;
  height: 100%;
  background: var(--el-bg-color);
  border-right: 1px solid var(--el-border-color-lighter);
  /* 寬度收縮動畫 */
  transition: width 0.25s ease;
  flex-shrink: 0;
  overflow: hidden;
}

/* 折疊狀態：只顯示圖標 */
.sidebar--collapsed {
  width: 64px;
}

/* Logo 區域 */
.sidebar-logo {
  display: flex;
  align-items: center;
  height: 52px;
  padding: 0 16px;
  gap: 10px;
  flex-shrink: 0;
  overflow: hidden;
}

.logo-icon {
  width: 32px;
  height: 32px;
  background: var(--el-color-primary);
  color: #fff;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: bold;
  flex-shrink: 0;
}

.logo-text {
  font-size: 15px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  white-space: nowrap;
}

/* 導航區域：佔滿剩餘高度 */
.sidebar-nav {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 8px 0;
}

.sidebar-nav::-webkit-scrollbar {
  width: 4px;
}

.sidebar-nav::-webkit-scrollbar-thumb {
  background: var(--el-border-color);
  border-radius: 2px;
}

.nav-empty {
  padding: 24px 16px;
  text-align: center;
}

/* 底部折疊按鈕 */
.sidebar-footer {
  flex-shrink: 0;
  padding-bottom: 8px;
}

.collapse-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: calc(100% - 16px);
  margin: 0 8px;
  height: 40px;
  border: none;
  background: transparent;
  color: var(--el-text-color-secondary);
  cursor: pointer;
  border-radius: 8px;
  font-size: 13px;
  transition: background 0.2s, color 0.2s;
}

.collapse-btn:hover {
  background: var(--el-fill-color-light);
  color: var(--el-color-primary);
}

.collapse-text {
  white-space: nowrap;
}
</style>
