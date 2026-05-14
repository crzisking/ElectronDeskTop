<script setup lang="ts">
/**
 * 側邊欄單個菜單項組件 — Warm Editorial 風格
 *
 * 樣式特徵：
 *  - 默認：透明背景、深灰文字
 *  - 懸停：暖色 hover 背景
 *  - 激活：黑色填充 + 白色文字（強對比，呼應 filter pill 的設計）
 *  - 右側 badge：兩位數字（06、12、03 等），跟隨激活狀態反色
 *
 * Props：
 *  - item：SidebarItem 配置（label / icon / routeName / badge）
 *  - collapsed：側邊欄是否折疊（折疊時只顯示圖標）
 */

import { computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import * as ElementPlusIconsVue from '@element-plus/icons-vue'
import {useConfigText} from '@/composables/useConfigText'
import type { SidebarItem } from '@/types/config.types'

const props = defineProps<{
  item: SidebarItem
  collapsed: boolean
}>()

const router = useRouter()
const route = useRoute()
const {ct} = useConfigText()

/**
 * 顯示用 label：走 i18n 字典 config.sidebar.<id>，缺失時 fallback 到 JSON 的 label。
 * 原文示例：統一平台 / 內部功能
 */
const displayLabel = computed(() => ct(`config.sidebar.${props.item.id}`, props.item.label))

/** 動態解析 Element Plus 圖標組件 */
const iconComponent = computed(() => {
  const icons = ElementPlusIconsVue as Record<string, unknown>
  return icons[props.item.icon] ?? null
})

/** 是否激活（路由匹配） */
const isActive = computed(() => route.name === props.item.routeName)

/**
 * 點擊菜單項跳轉到對應路由
 * 用 .catch 吞掉「路由不存在」的錯誤（系統分組的 settings/help 暫未實作）
 */
function navigate() {
  if (!isActive.value) {
    router.push({ name: props.item.routeName }).catch(() => {})
  }
}
</script>

<template>
  <button
    type="button"
    class="nav-item"
    :class="{ 'is-active': isActive, 'is-collapsed': collapsed }"
    :title="collapsed ? displayLabel : ''"
    role="menuitem"
    :aria-current="isActive ? 'page' : undefined"
    @click="navigate"
  >
    <span class="nav-icon">
      <el-icon v-if="iconComponent" :size="16">
        <component :is="iconComponent" />
      </el-icon>
      <span v-else class="icon-placeholder">{{ displayLabel.charAt(0) }}</span>
    </span>

    <span v-show="!collapsed" class="nav-label">{{ displayLabel }}</span>

    <span v-if="item.badge && !collapsed" class="nav-badge">{{ item.badge }}</span>
  </button>
</template>

<style scoped>
.nav-item {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  height: 38px;
  padding: 0 12px;
  border: none;
  background: transparent;
  color: var(--app-text-secondary);
  cursor: pointer;
  border-radius: 10px;
  font-size: 13.5px;
  font-weight: 500;
  text-align: left;
  transition: background 0.15s, color 0.15s;
  white-space: nowrap;
  overflow: hidden;
}

.nav-item.is-collapsed {
  justify-content: center;
  padding: 0;
}

.nav-item:hover {
  background: var(--app-bg-surface);
  color: var(--app-text-primary);
}

/* 激活狀態:品牌藍 pill + 白字,在淺灰底上是唯一的色彩焦點 */
.nav-item.is-active {
  background: var(--app-brand);
  color: var(--app-text-inverse);
}

.nav-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 20px;
  height: 20px;
}

.icon-placeholder {
  width: 18px;
  height: 18px;
  background: var(--app-bg-muted);
  color: inherit;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 600;
}

.nav-label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  letter-spacing: 0.02em;
}

/* 右側徽標：兩位數字小膠囊 */
.nav-badge {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.08em;
  padding: 2px 7px;
  border-radius: 999px;
  background: var(--app-bg-muted);
  color: var(--app-text-muted);
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
}

/* 激活時 pill 已變品牌藍,徽標用半透明白做次層 */
.nav-item.is-active .nav-badge {
  background: rgba(255, 255, 255, 0.22);
  color: var(--app-text-inverse);
}
</style>
