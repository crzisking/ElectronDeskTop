<script setup lang="ts">
/**
 * 自定義標題欄組件
 *
 * 因為主窗口使用 frame: false（無邊框），
 * 需要在 Vue 中自行渲染標題欄，提供：
 *  - 窗口拖動區域（-webkit-app-region: drag）
 *  - 應用圖標 + 標題
 *  - 最小化 / 最大化還原 / 關閉 三個控制按鈕
 *
 * 關鍵 CSS 說明：
 *  - .title-bar-drag：設置 -webkit-app-region: drag，讓此區域可拖動窗口
 *  - .window-btn：設置 -webkit-app-region: no-drag，防止按鈕點擊被拖動吞噬
 *
 * 最大化狀態從 uiStore.isWindowMaximized 讀取，
 * 由 App.vue 監聽主進程推送的 push:window-maximized 事件後更新。
 */

import { computed } from 'vue'
import {useI18n} from 'vue-i18n'
import { useUiStore } from '@/stores/ui.store'

const uiStore = useUiStore()
const {t} = useI18n()

/** 當前是否最大化（控制最大化/還原按鈕的圖標切換） */
const isMaximized = computed(() => uiStore.isWindowMaximized)

// ─── 窗口控制方法 ─────────────────────────────────────────────
/** 最小化主窗口 */
function minimize() {
  window.electronAPI.window.minimize()
}

/** 切換最大化/還原 */
function toggleMaximize() {
  window.electronAPI.window.maximize()
}

/**
 * 關閉主窗口
 * 注意：這不是退出應用，而是隱藏主窗口並顯示浮球
 * 真正退出應用使用系統托盤的"結束應用程式"
 */
function closeWindow() {
  window.electronAPI.window.close()
}
</script>

<template>
  <!-- 標題欄容器：整體可拖動 -->
  <div class="title-bar">
    <!-- 拖動區域：flex 佔滿剩餘空間，設置 app-region: drag -->
    <div class="title-bar-drag">
      <!-- 應用 Logo（拖動區，無標題文字） -->
      <div class="title-bar-brand">
        <img class="app-icon" src="@/assets/logo.png" alt="ichia" />
      </div>
    </div>

    <!-- 窗口控制按鈕組：no-drag 確保點擊可響應 -->
    <div class="window-controls">
      <!-- 最小化按鈕 -->
      <!-- 原文 title：最小化 -->
      <button class="window-btn" :title="t('titleBar.minimize')" @click="minimize">
        <svg width="10" height="1" viewBox="0 0 10 1">
          <line x1="0" y1="0.5" x2="10" y2="0.5" stroke="currentColor" stroke-width="1.5" />
        </svg>
      </button>

      <!-- 最大化/還原按鈕（根據狀態切換圖標） -->
      <!-- 原文 title：還原 / 最大化 -->
      <button class="window-btn" :title="isMaximized ? t('titleBar.restore') : t('titleBar.maximize')" @click="toggleMaximize">
        <!-- 還原圖標（兩個重疊的矩形） -->
        <svg v-if="isMaximized" width="10" height="10" viewBox="0 0 10 10">
          <rect x="2" y="0" width="8" height="8" fill="none" stroke="currentColor" stroke-width="1.5" />
          <rect x="0" y="2" width="8" height="8" fill="none" stroke="currentColor" stroke-width="1.5" />
        </svg>
        <!-- 最大化圖標（單個矩形） -->
        <svg v-else width="10" height="10" viewBox="0 0 10 10">
          <rect x="0" y="0" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.5" />
        </svg>
      </button>

      <!-- 關閉按鈕（紅色懸停） -->
      <!-- 原文 title：關閉（最小化到浮球） -->
      <button class="window-btn close-btn" :title="t('titleBar.closeToTray')" @click="closeWindow">
        <svg width="10" height="10" viewBox="0 0 10 10">
          <line x1="0" y1="0" x2="10" y2="10" stroke="currentColor" stroke-width="1.5" />
          <line x1="10" y1="0" x2="0" y2="10" stroke="currentColor" stroke-width="1.5" />
        </svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
.title-bar {
  display: flex;
  align-items: center;
  height: var(--titlebar-height);
  background: var(--app-bg-canvas);
  color: var(--app-text-primary);
  flex-shrink: 0;
  user-select: none;
  border-bottom: 1px solid var(--app-border-subtle);
}

/* 拖動區域：佔滿剩餘空間 */
.title-bar-drag {
  flex: 1;
  display: flex;
  align-items: center;
  height: 100%;
  -webkit-app-region: drag;
  padding-left: 16px;
}

.title-bar-brand {
  display: flex;
  align-items: center;
  gap: 10px;
}

.app-icon {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  object-fit: contain;
}

.app-title {
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--app-text-secondary);
}

.app-title__brand {
  color: var(--app-brand);
  font-style: italic;
  font-weight: 600;
  text-transform: lowercase;
  letter-spacing: 0;
  margin-right: 4px;
}

/* 窗口控制按鈕組 */
.window-controls {
  display: flex;
  align-items: center;
  height: 100%;
  -webkit-app-region: no-drag;
}

.window-btn {
  width: 42px;
  height: 100%;
  border: none;
  background: transparent;
  color: var(--app-text-secondary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s, color 0.15s;
  outline: none;
}

.window-btn:hover {
  background: var(--app-bg-muted);
  color: var(--app-text-primary);
}

/* 關閉按鈕懸停時顯示暖紅色背景 */
.close-btn:hover {
  background: var(--app-danger) !important;
  color: #fff !important;
}
</style>
