<script setup lang="ts">
/**
 * 左側邊欄導航 — Warm Editorial 風格(主壳)。
 *
 *  ┌──────────────────────┐
 *  │ ──── 工作台(SidebarNavItem 列表,config 驅動)
 *  │ ──── 系統(SidebarSystemLinks)
 *  │ ──── 用戶卡片 + 設定(SidebarUserCorner)
 *  │ ──── 收合按鈕(SidebarCollapseHandle)
 *  └──────────────────────┘
 *
 * 工作台 nav 由 configStore.sidebarItems 驅動 + 動態 badge 注入。
 * 系統分組由 configStore.systemLinkItems 驅動。
 */

import {computed} from 'vue'
import {useConfigStore} from '@/stores/config.store'
import {useUiStore} from '@/stores/ui.store'
import {useI18n} from 'vue-i18n'
import SidebarNavItem from './SidebarNavItem.vue'
import SidebarSystemLinks from './sidebar/SidebarSystemLinks.vue'
import SidebarUserCorner from './sidebar/SidebarUserCorner.vue'
import SidebarCollapseHandle from './sidebar/SidebarCollapseHandle.vue'
import type {SidebarItem} from '@/types/config'

const configStore = useConfigStore()
const uiStore = useUiStore()
const {t} = useI18n()

/**
 * 工作台 nav 項:configStore.sidebarItems + 動態 badge。
 * unified-platform → 平台系統數(zero-pad);internal-functions → 內部工具數;其餘不顯示。
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
        badge = pad2(configStore.functionsConfig?.tools?.length ?? 0)
        break
    }
    return badge ? {...item, badge} : item
  })
})

const collapsed = computed(() => uiStore.sidebarCollapsed)
</script>

<template>
  <aside :class="{'sidebar--collapsed': collapsed}" class="sidebar">
    <!-- 工作台分組 -->
    <div class="sidebar-section">
      <div v-show="!collapsed" class="section-label">{{ t('sidebar.sectionWorkspace') }}</div>
      <nav :aria-label="t('sidebar.sectionWorkspace')" class="section-nav" role="menu">
        <SidebarNavItem
            v-for="item in workspaceItems"
            :key="item.id"
            :collapsed="collapsed"
            :item="item"
        />
        <div v-if="workspaceItems.length === 0" class="nav-empty">
          <el-text size="small" type="info">{{ t('sidebar.emptyMenu') }}</el-text>
        </div>
      </nav>
    </div>

    <!-- 系統分組 -->
    <SidebarSystemLinks :collapsed="collapsed" :links="configStore.systemLinkItems"/>

    <!-- 推用戶卡片到底 -->
    <div class="sidebar-spacer"/>

    <!-- 用戶卡片 + 語言切換 + 設定 -->
    <SidebarUserCorner :collapsed="collapsed"/>

    <!-- 收合按鈕 -->
    <SidebarCollapseHandle :collapsed="collapsed" @toggle="uiStore.toggleSidebar"/>
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
  padding: 22px 14px 14px;
  flex-shrink: 0;
  overflow: hidden;
  transition: width 0.25s ease;
}

.sidebar--collapsed {
  width: var(--sidebar-width-collapsed);
  padding: 22px 10px 14px;
}

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

.sidebar-spacer {
  flex: 1;
  min-height: 12px;
}
</style>
