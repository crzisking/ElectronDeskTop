<script setup lang="ts">
/**
 * 側邊欄單個菜單項組件
 *
 * 功能：
 *  - 展示圖標（Element Plus 圖標，動態 component :is 渲染）
 *  - 展示文字標籤（折疊時隱藏）
 *  - 展示右側 badge（可選）
 *  - 激活狀態高亮（通過 route.name 判斷）
 *  - 點擊跳轉到對應路由
 *
 * Props 說明：
 *  - item：SidebarItem 配置對象
 *  - collapsed：側邊欄是否折疊（折疊時只顯示圖標）
 */

import { computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import * as ElementPlusIconsVue from '@element-plus/icons-vue'
import type { SidebarItem } from '@/types/config.types'

const props = defineProps<{
  /** 菜單項配置（來自 app-config.json sidebar.items） */
  item: SidebarItem
  /** 側邊欄是否已折疊 */
  collapsed: boolean
}>()

const router = useRouter()
const route = useRoute()

/**
 * 動態解析 Element Plus 圖標組件
 * config 中存儲的是圖標名稱字符串（如 "Grid"），
 * 這裡將其映射到實際的 Vue 組件。
 *
 * 如果圖標名不存在，返回 null（不渲染圖標）
 */
const iconComponent = computed(() => {
  const icons = ElementPlusIconsVue as Record<string, unknown>
  return icons[props.item.icon] ?? null
})

/** 當前菜單項是否激活（路由匹配） */
const isActive = computed(() => route.name === props.item.routeName)

/** 點擊菜單項，跳轉到對應路由 */
function navigate() {
  if (!isActive.value) {
    router.push({ name: props.item.routeName })
  }
}
</script>

<template>
  <div
    class="nav-item"
    :class="{ 'is-active': isActive, 'is-collapsed': collapsed }"
    :title="collapsed ? item.label : ''"
    role="menuitem"
    :aria-current="isActive ? 'page' : undefined"
    @click="navigate"
  >
    <!-- 左側圖標 -->
    <span class="nav-icon">
      <el-icon v-if="iconComponent" :size="18">
        <component :is="iconComponent" />
      </el-icon>
      <!-- 圖標不存在時顯示首字母占位 -->
      <span v-else class="icon-placeholder">{{ item.label.charAt(0) }}</span>
    </span>

    <!-- 標籤文字（折疊時隱藏，通過 CSS transition 動畫） -->
    <span class="nav-label" :class="{ hidden: collapsed }">{{ item.label }}</span>

    <!-- 右側 badge（可選） -->
    <el-badge
      v-if="item.badge && !collapsed"
      :value="item.badge"
      class="nav-badge"
      type="danger"
    />
  </div>
</template>

<style scoped>
.nav-item {
  display: flex;
  align-items: center;
  height: 48px;
  padding: 0 16px;
  cursor: pointer;
  border-radius: 8px;
  margin: 2px 8px;
  transition: background 0.2s, color 0.2s;
  color: var(--el-text-color-secondary);
  position: relative;
  gap: 10px;
  overflow: hidden;
  white-space: nowrap;
}

/* 懸停狀態 */
.nav-item:hover {
  background: var(--el-fill-color-light);
  color: var(--el-color-primary);
}

/* 激活狀態 */
.nav-item.is-active {
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
  font-weight: 600;
}

/* 激活狀態左側指示條 */
.nav-item.is-active::before {
  content: '';
  position: absolute;
  left: 0;
  top: 50%;
  transform: translateY(-50%);
  width: 3px;
  height: 24px;
  background: var(--el-color-primary);
  border-radius: 0 2px 2px 0;
}

.nav-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 24px;
}

.icon-placeholder {
  width: 20px;
  height: 20px;
  background: var(--el-color-primary-light-7);
  color: var(--el-color-primary);
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: bold;
}

/* 文字標籤：折疊時透明度過渡動畫 */
.nav-label {
  flex: 1;
  font-size: 14px;
  transition: opacity 0.2s, width 0.2s;
  overflow: hidden;
}

.nav-label.hidden {
  opacity: 0;
  width: 0;
}

/* Badge 靠右對齊 */
.nav-badge {
  margin-left: auto;
}
</style>
