<script setup lang="ts">
/**
 * 左側邊欄導航組件 — Warm Editorial 風格
 *
 * 結構：
 *  ┌──────────────────────┐
 *  │ Brand：logo + 客戶端名 + 版本
 *  │ ──── 工作台（section）
 *  │   工作台導航項（config 驅動，可帶 badge 計數）
 *  │ ──── 系統（section）
 *  │   設定 / 幫助與回饋
 *  │ ──── 用戶卡片（底部）
 *  │ ──── 收合按鈕
 *  └──────────────────────┘
 *
 * 完全由 configStore.sidebarItems 驅動工作台分組；
 * 系統分組固定（設定 / 幫助與回饋）。
 */

import { ref, computed } from 'vue'
import { useConfigStore } from '@/stores/config.store'
import { useUiStore } from '@/stores/ui.store'
import { useAuthStore } from '@/stores/auth.store'
import SidebarNavItem from './SidebarNavItem.vue'
import SettingsDialog from '@/views/Settings/SettingsDialog.vue'
import { ArrowLeftBold, Setting } from '@element-plus/icons-vue'
import type { SidebarItem } from '@/types/config.types'

const configStore = useConfigStore()
const uiStore = useUiStore()
const authStore = useAuthStore()

/**
 * 工作台分組：基於 configStore.sidebarItems，並動態注入計數徽標。
 * 徽標規則：
 *  - unified-platform   → 平台系統數量（zero-pad 兩位）
 *  - internal-functions → 內部工具數量
 *  - business           → 業務功能數量（暫固定 03）
 */
const workspaceItems = computed<SidebarItem[]>(() => {
  const pad2 = (n: number) => (n < 10 ? `0${n}` : `${n}`)
  return configStore.sidebarItems.map((item) => {
    let badge: string | undefined
    switch (item.routeName) {
      case 'unified-platform':
        badge = pad2(configStore.platformSystems.length)
        break
      case 'internal-functions':
        badge = pad2((configStore.functionsConfig?.tools?.length ?? 0))
        break
      case 'business':
        badge = '03'
        break
    }
    return badge ? { ...item, badge } : item
  })
})

/** 當前是否折疊 */
const collapsed = computed(() => uiStore.sidebarCollapsed)

/** 用戶顯示信息（fallback：未登錄時顯示佔位） */
const userName = computed(() => authStore.user?.name ?? '訪客')
const userInitial = computed(() => userName.value.charAt(0))

/** 切換折疊狀態 */
function toggleCollapse() {
  uiStore.toggleSidebar()
}

// ── 設置彈窗 ────────────────────────────────────────────────────
/**
 * 設置彈窗顯示狀態（v-model 綁定到 SettingsDialog）。
 * 由用戶名旁邊的齒輪按鈕觸發。
 */
const settingsVisible = ref(false)

function openSettings() {
  settingsVisible.value = true
}
</script>

<template>
  <aside class="sidebar" :class="{ 'sidebar--collapsed': collapsed }">
    <!-- ── 工作台分組 ──────────────────────────────────────── -->
    <div class="sidebar-section">
      <div v-show="!collapsed" class="section-label">工作台</div>
      <nav class="section-nav" role="menu" aria-label="工作台">
        <SidebarNavItem
          v-for="item in workspaceItems"
          :key="item.id"
          :item="item"
          :collapsed="collapsed"
        />
        <div v-if="workspaceItems.length === 0" class="nav-empty">
          <el-text type="info" size="small">菜單配置為空</el-text>
        </div>
      </nav>
    </div>

    <!-- ── 底部：用戶卡片（頭像 + 姓名 + 設置按鈕） ────────── -->
    <div class="sidebar-spacer" />
    <div class="sidebar-user">
      <div class="user-avatar">{{ userInitial }}</div>
      <div v-show="!collapsed" class="user-info">
        <div class="user-name">{{ userName }}</div>
      </div>
      <!--
        設置按鈕：折疊狀態下也保留（小屏依然能進設定），
        完全隱藏會讓收合後找不到設定入口
      -->
      <button
        type="button"
        class="settings-btn"
        :title="'設定'"
        @click="openSettings"
      >
        <el-icon :size="16"><Setting /></el-icon>
      </button>
    </div>

    <!-- ── 收合按鈕 ───────────────────────────────────────── -->
    <button class="collapse-handle" type="button" :title="collapsed ? '展開側邊欄' : '收合側邊欄'" @click="toggleCollapse">
      <el-icon :size="14" :style="{ transform: collapsed ? 'rotate(180deg)' : 'none' }">
        <ArrowLeftBold />
      </el-icon>
      <span v-show="!collapsed" class="collapse-label">收合側邊欄</span>
    </button>

    <!-- 設置彈窗（透過 Teleport 渲染到 body，不受側邊欄裁剪） -->
    <SettingsDialog v-model="settingsVisible" />
  </aside>
</template>

<style scoped>
.sidebar {
  display: flex;
  flex-direction: column;
  width: var(--sidebar-width);
  height: 100%;
  background: var(--app-bg-sidebar);
  border-radius: var(--app-radius-lg);
  border: 1px solid var(--app-border-subtle);
  padding: 22px 14px 14px;
  flex-shrink: 0;
  overflow: hidden;
  transition: width 0.25s ease;
}

.sidebar--collapsed {
  width: var(--sidebar-width-collapsed);
  padding: 22px 10px 14px;
}

/* ── Brand ───────────────────────────────────────────────── */
.sidebar-brand {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  padding: 0 6px 16px;
  border-bottom: 1px solid var(--app-border-subtle);
  margin-bottom: 18px;
  flex-shrink: 0;
}

.brand-logo {
  width: 38px;
  height: 38px;
  border-radius: 8px;
  background: var(--app-bg-surface);
  border: 1px solid var(--app-border-subtle);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  box-shadow: var(--app-shadow-sm);
}

.brand-logo__letter {
  font-family: var(--app-font-display);
  font-style: italic;
  font-weight: 600;
  font-size: 22px;
  color: var(--app-brand);
  line-height: 1;
}

.brand-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.brand-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--app-text-primary);
  letter-spacing: 0.02em;
}

.brand-version {
  font-size: 11px;
  letter-spacing: 0.18em;
  color: var(--app-text-muted);
  text-transform: lowercase;
}

/* ── Section ─────────────────────────────────────────────── */
.sidebar-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex-shrink: 0;
  margin-bottom: 18px;
}

.section-label {
  font-size: 11px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--app-text-muted);
  padding: 0 8px;
  margin-bottom: 4px;
}

.section-nav {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.nav-empty {
  padding: 8px;
  text-align: center;
}

/* ── Spacer：把用戶卡片推到底 ──────────────────────────────── */
.sidebar-spacer {
  flex: 1;
  min-height: 12px;
}

/* ── 用戶卡片 ────────────────────────────────────────────── */
.sidebar-user {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 8px;
  border-top: 1px solid var(--app-border-subtle);
  margin-top: 8px;
}

.user-avatar {
  width: 36px;
  height: 36px;
  border-radius: 999px;
  background: var(--app-bg-surface);
  border: 1px solid var(--app-border-subtle);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 600;
  color: var(--app-text-primary);
  flex-shrink: 0;
}

.user-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.user-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--app-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.user-role {
  font-size: 11px;
  color: var(--app-text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.user-more {
  width: 28px;
  height: 28px;
  border-radius: 999px;
  border: none;
  background: transparent;
  color: var(--app-text-muted);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s, color 0.15s;
  flex-shrink: 0;
}

.user-more:hover {
  background: var(--app-bg-elevated);
  color: var(--app-text-primary);
}

/* ── 用戶名旁的設置按鈕 ─────────────────────────────────────── */
.settings-btn {
  width: 32px;
  height: 32px;
  border-radius: 999px;
  border: none;
  background: transparent;
  color: var(--app-text-muted);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s, color 0.15s, transform 0.18s;
  flex-shrink: 0;
}

.settings-btn:hover {
  background: var(--app-bg-surface);
  color: var(--app-text-primary);
  transform: rotate(60deg);
}

.settings-btn:active {
  transform: rotate(60deg) scale(0.95);
}

/* ── 收合按鈕 ────────────────────────────────────────────── */
.collapse-handle {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 30px;
  margin-top: 6px;
  border: none;
  background: transparent;
  color: var(--app-text-muted);
  cursor: pointer;
  border-radius: 6px;
  font-size: 12px;
  transition: background 0.15s, color 0.15s;
}

.collapse-handle:hover {
  background: var(--app-bg-elevated);
  color: var(--app-text-primary);
}

.collapse-label {
  letter-spacing: 0.05em;
}
</style>
