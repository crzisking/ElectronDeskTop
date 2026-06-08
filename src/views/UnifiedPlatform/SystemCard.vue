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

import {computed} from 'vue'
import {useI18n} from 'vue-i18n'
import {useConfigText} from '@/shared/composables/useConfigText'
import type {SystemLink} from '@shared/types/config'
import {ArrowRight} from "@element-plus/icons-vue";

const props = defineProps<{
  system: SystemLink
}>()

const emit = defineEmits<{
  /** 用戶請求打開系統 */
  (e: 'open', system: SystemLink): void
}>()

const {t} = useI18n()
const {ct} = useConfigText()

/**
 * 顯示用名稱與描述：走 i18n config.systems.<id>.{name,description}，
 * 缺失則 fallback 到 JSON 原值。原文示例：新ERP 系統 / ERP系統
 */
const displayName = computed(() => ct(`config.systems.${props.system.id}.name`, props.system.name))
const displayDesc = computed(() => ct(`config.systems.${props.system.id}.description`, props.system.description))
</script>

<template>
  <div class="system-card" @click="emit('open', system)">
    <!-- 系統圖標 -->
    <div class="card-icon">
      <img
        v-if="system.iconUrl"
        :src="system.iconUrl"
        :alt="displayName"
        class="icon-img"
        @error="($event.target as HTMLImageElement).style.display = 'none'"
      />
      <!-- 圖標加載失敗或無圖標時顯示首字母 -->
      <span v-else class="icon-text">{{ displayName.charAt(0) }}</span>
    </div>

    <!-- 系統信息 -->
    <div class="card-info">
      <div class="card-name">{{ displayName }}</div>
      <div class="card-desc">{{ displayDesc }}</div>

      <!-- 標籤組 -->
      <!-- 原文：SSO 直通 -->
      <div class="card-tags">
        <el-tag v-if="system.ssoEnabled" size="small" type="success" effect="light">
          {{ t('platform.tagSso') }}
        </el-tag>
        <!-- 打開方式標籤（原文：嵌入顯示 / 獨立窗口 / 外部瀏覽器） -->
        <el-tag
          size="small"
          :type="system.openMode === 'iframe' ? 'primary' : system.openMode === 'electron-window' ? 'warning' : 'info'"
          effect="light"
        >
          {{
            system.openMode === 'iframe'
              ? t('platform.openModeIframe')
              : system.openMode === 'electron-window'
                ? t('platform.openModeWindow')
                : t('platform.openModeBrowser')
          }}
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
  padding: 18px;
  background: var(--app-bg-surface);
  border: 1px solid var(--app-border-subtle);
  border-radius: var(--app-radius-lg);
  box-shadow: var(--app-shadow-sm);
  cursor: pointer;
  transition: box-shadow 0.25s ease, transform 0.25s ease, border-color 0.25s ease;
  position: relative;
  overflow: hidden;
}

.system-card:hover {
  border-color: var(--app-border-default);
  box-shadow: var(--app-shadow-card-hover);
  transform: translateY(-2px);
}

.system-card:active {
  transform: translateY(0);
}

/* 系統圖標 */
.card-icon {
  width: 44px;
  height: 44px;
  border-radius: 10px;
  background: var(--app-bg-elevated);
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
  font-size: 18px;
  font-weight: 700;
  color: var(--app-text-primary);
}

/* 系統信息 */
.card-info {
  flex: 1;
  min-width: 0;
}

.card-name {
  font-size: 15px;
  font-weight: 600;
  color: var(--app-text-primary);
  margin-bottom: 4px;
  letter-spacing: -0.005em;
}

.card-desc {
  font-size: 12px;
  color: var(--app-text-secondary);
  margin-bottom: 10px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.card-tags {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

/* 箭頭圖標（懸停時顯示） */
.card-action {
  color: var(--app-text-muted);
  transition: color 0.2s ease, transform 0.2s ease;
  flex-shrink: 0;
}

.system-card:hover .card-action {
  color: var(--app-text-primary);
  transform: translateX(2px);
}
</style>
