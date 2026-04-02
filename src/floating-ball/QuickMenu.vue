<script setup lang="ts">
/**
 * 浮球右鍵快捷菜單（自定義 Vue 菜單）
 *
 * 不使用 Electron 原生 Menu，改用 Vue 渲染的覆蓋層，
 * 原因：
 *  1. 視覺風格可與主應用保持一致
 *  2. 原生 Menu 需要主進程中轉，交互延遲更高
 *  3. 自定義菜單支持更豐富的樣式（圖標、分隔線等）
 *
 * 菜單項數據從主進程讀取（config.floatingBall.quickMenu）
 *
 * 顯示邏輯：
 *  - 右鍵點擊浮球 → FloatingBall.vue emit('showMenu', event)
 *  - App.vue 接收並計算菜單位置，設置 visible = true
 *  - 點擊菜單外區域 → 隱藏菜單
 */

import { ref, onMounted, onUnmounted } from 'vue'
import type { AppConfig, QuickMenuItem } from '../../src/types/config.types'

/** 菜單是否可見 */
const visible = ref(false)
/** 菜單顯示位置（屏幕坐標相對窗口） */
const menuX = ref(0)
const menuY = ref(0)
/** 從配置讀取的菜單項 */
const menuItems = ref<QuickMenuItem[]>([])

/** 加載菜單項（從主進程讀取配置） */
async function loadMenuItems() {
  try {
    const config = await window.electronAPI.config.read() as AppConfig
    menuItems.value = config.floatingBall.quickMenu.filter((item) => item.enabled)
  } catch (err) {
    console.error('[QuickMenu] 加載菜單配置失敗:', err)
  }
}

/**
 * 顯示菜單
 * @param x 鼠標 X 坐標（相對於窗口）
 * @param y 鼠標 Y 坐標（相對於窗口）
 */
function show(x: number, y: number) {
  // 菜單默認在右鍵位置右下方，若接近窗口邊界則反向
  menuX.value = x
  menuY.value = y
  visible.value = true
}

/** 隱藏菜單 */
function hide() {
  visible.value = false
}

/**
 * 執行菜單項操作
 * 通過 preload 暴露的 executeMenuAction 執行
 */
function executeAction(item: QuickMenuItem) {
  hide()

  const { action } = item
  switch (action.type) {
    case 'show-main-window':
      window.electronAPI.window.show()
      break

    case 'navigate':
      // 顯示主窗口 + 通知主進程轉發路由導航指令
      window.electronAPI.executeMenuAction('navigate', action.routeName)
      break

    case 'quit-app':
      window.electronAPI.executeMenuAction('quit-app')
      break

    case 'open-url':
      window.open(action.url, '_blank')
      break
  }
}

/** 點擊窗口任意位置關閉菜單 */
function onClickOutside() {
  if (visible.value) hide()
}

onMounted(async () => {
  await loadMenuItems()
  window.addEventListener('click', onClickOutside)
})

onUnmounted(() => {
  window.removeEventListener('click', onClickOutside)
})

/** 暴露 show 方法給父組件調用 */
defineExpose({ show, hide })
</script>

<template>
  <!-- 菜單背景遮罩（透明，攔截點擊關閉菜單） -->
  <teleport to="body">
    <div
      v-if="visible"
      class="menu-overlay"
      @click.self="hide"
      @contextmenu.prevent
    >
      <!-- 菜單面板 -->
      <div
        class="quick-menu"
        :style="{ left: `${menuX}px`, top: `${menuY}px` }"
        @click.stop
      >
        <template v-for="item in menuItems" :key="item.id">
          <!-- 分隔線 -->
          <div v-if="item.separator" class="menu-separator" />

          <!-- 菜單項 -->
          <div
            v-if="item.label"
            class="menu-item"
            @click="executeAction(item)"
          >
            <!-- 圖標占位（實際圖標需要從 Element Plus Icons 動態渲染） -->
            <span class="menu-item-icon">{{ item.icon ? '●' : '' }}</span>
            <span class="menu-item-label">{{ item.label }}</span>
          </div>
        </template>

        <!-- 兜底：若無菜單項 -->
        <div v-if="!menuItems.length" class="menu-item" style="color:var(--el-text-color-placeholder)">
          無快捷菜單配置
        </div>
      </div>
    </div>
  </teleport>
</template>

<style scoped>
/* 透明遮罩：全屏，攔截點擊 */
.menu-overlay {
  position: fixed;
  inset: 0;
  z-index: 9998;
}

/* 菜單面板 */
.quick-menu {
  position: absolute;
  min-width: 160px;
  background: var(--el-bg-color, #fff);
  border: 1px solid var(--el-border-color-lighter, #e8e8e8);
  border-radius: 10px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
  padding: 4px 0;
  z-index: 9999;
  /* 彈出動畫 */
  animation: menuFadeIn 0.15s ease;
}

@keyframes menuFadeIn {
  from { opacity: 0; transform: scale(0.92); }
  to   { opacity: 1; transform: scale(1); }
}

/* 菜單項 */
.menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 16px;
  cursor: pointer;
  font-size: 13px;
  color: #333;
  transition: background 0.1s;
  white-space: nowrap;
}

.menu-item:hover {
  background: #f0f7ff;
  color: #409eff;
}

.menu-item-icon {
  font-size: 8px;
  color: #409eff;
  width: 14px;
  text-align: center;
  flex-shrink: 0;
}

/* 分隔線 */
.menu-separator {
  height: 1px;
  background: #f0f0f0;
  margin: 4px 0;
}
</style>
