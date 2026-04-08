<script setup lang="ts">
/**
 * 系統快捷卡片組件
 *
 * 展示單個內部系統的入口卡片，包含：
 *  - 系統圖標（有 iconUrl 則加載圖片，否則顯示首字母）
 *  - 系統名稱和描述
 *  - SSO 標記（若啟用 SSO）
 *  - 打開方式標記（iframe / 外部瀏覽器）
 *  - "打開"按鈕
 *
 * Props：
 *  - system：SystemLink 配置對象（來自 app-config.json）
 *
 * Emits：
 *  - open：用戶點擊"打開"按鈕時觸發，父組件負責處理打開邏輯
 */

import type { SystemLink } from '@/types/config.types'
import {ArrowRight} from "@element-plus/icons-vue";

defineProps<{
  system: SystemLink
}>()

const emit = defineEmits<{
  /** 用戶請求打開系統 */
  (e: 'open', system: SystemLink): void
}>()
</script>

<template>
  <div class="system-card" @click="emit('open', system)">
    <!-- 系統圖標 -->
    <div class="card-icon">
      <img
        v-if="system.iconUrl"
        :src="system.iconUrl"
        :alt="system.name"
        class="icon-img"
        @error="($event.target as HTMLImageElement).style.display = 'none'"
      />
      <!-- 圖標加載失敗或無圖標時顯示首字母 -->
      <span v-else class="icon-text">{{ system.name.charAt(0) }}</span>
    </div>

    <!-- 系統信息 -->
    <div class="card-info">
      <div class="card-name">{{ system.name }}</div>
      <div class="card-desc">{{ system.description }}</div>

      <!-- 標籤組 -->
      <div class="card-tags">
        <el-tag v-if="system.ssoEnabled" size="small" type="success" effect="light">
          SSO 直通
        </el-tag>
        <!-- 打開方式標籤：iframe=嵌入顯示 / electron-window=獨立窗口 / external-browser=外部瀏覽器 -->
        <el-tag
          size="small"
          :type="system.openMode === 'iframe' ? 'primary' : system.openMode === 'electron-window' ? 'warning' : 'info'"
          effect="light"
        >
          {{ system.openMode === 'iframe' ? '嵌入顯示' : system.openMode === 'electron-window' ? '獨立窗口' : '外部瀏覽器' }}
        </el-tag>
      </div>
    </div>

    <!-- 打開按鈕（懸停時顯示） -->
    <div class="card-action">
      <el-icon><ArrowRight /></el-icon>
    </div>
  </div>
</template>

<style scoped>
.system-card {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 16px;
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.2s;
  position: relative;
  overflow: hidden;
}

.system-card:hover {
  border-color: var(--el-color-primary-light-5);
  box-shadow: 0 4px 16px rgba(64, 158, 255, 0.12);
  transform: translateY(-2px);
}

.system-card:active {
  transform: translateY(0);
}

/* 懸停時顯示左側高亮條 */
.system-card::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 3px;
  background: var(--el-color-primary);
  transform: scaleY(0);
  transition: transform 0.2s;
  border-radius: 0 2px 2px 0;
}

.system-card:hover::before {
  transform: scaleY(1);
}

/* 系統圖標 */
.card-icon {
  width: 48px;
  height: 48px;
  border-radius: 12px;
  background: var(--el-color-primary-light-9);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  overflow: hidden;
}

.icon-img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.icon-text {
  font-size: 20px;
  font-weight: bold;
  color: var(--el-color-primary);
}

/* 系統信息 */
.card-info {
  flex: 1;
  min-width: 0;
}

.card-name {
  font-size: 15px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  margin-bottom: 4px;
}

.card-desc {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-bottom: 8px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.card-tags {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}

/* 箭頭圖標（懸停時顯示） */
.card-action {
  color: var(--el-color-primary);
  opacity: 0;
  transition: opacity 0.2s;
  flex-shrink: 0;
}

.system-card:hover .card-action {
  opacity: 1;
}
</style>
