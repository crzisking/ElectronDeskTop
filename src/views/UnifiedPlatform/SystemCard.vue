<script setup lang="ts">
/**
 * 系統快捷卡片組件
 *
 * 展示單個內部系統的入口卡片，包含：
 *  - 系統圖標（有 iconUrl 則加載圖片，否則顯示首字母）
 *  - 系統名稱和描述
 *  - SSO 標記（若啟用 SSO）
 *  - 右上角打開方式下拉（桌面窗口 / 瀏覽器 —— 使用者可自行選，見 effectiveMode）
 *  - "打開"按鈕
 *
 * Props：
 *  - system：SystemLink 配置對象（管理員設定，來自 DB）
 *  - effectiveMode：合併使用者覆寫後的實際打開方式（父層用 resolveOpenMode() 算好傳入）
 *
 * Emits：
 *  - open：用戶點擊卡片時觸發，父組件負責處理打開邏輯
 *  - change-mode：用戶切換桌面窗口/瀏覽器時觸發（iframe 系統不會觸發,見 isModeToggleable）
 */

import {computed} from 'vue'
import {useI18n} from 'vue-i18n'
import {useConfigText} from '@/shared/composables/useConfigText'
import type {SystemLink} from '@shared/types/config'
import {isModeToggleable, type UserToggleableMode} from '@/shared/utils/system-open-mode'
import {ArrowRight, CaretBottom} from "@element-plus/icons-vue";

const props = defineProps<{
  system: SystemLink
  effectiveMode: SystemLink['openMode']
}>()

const emit = defineEmits<{
  /** 用戶請求打開系統 */
  (e: 'open', system: SystemLink): void
  /** 用戶切換打開方式(僅非 iframe 系統) */
  (e: 'change-mode', mode: UserToggleableMode): void
}>()

const {t} = useI18n()
const {ct} = useConfigText()

/**
 * 顯示用名稱與描述：走 i18n config.systems.<id>.{name,description}，
 * 缺失則 fallback 到 JSON 原值。原文示例：新ERP 系統 / ERP系統
 */
const displayName = computed(() => ct(`config.systems.${props.system.id}.name`, props.system.name))
const displayDesc = computed(() => ct(`config.systems.${props.system.id}.description`, props.system.description))

const toggleable = computed(() => isModeToggleable(props.system))

/** 右上角下拉當前顯示的短標籤 */
const modeLabel = computed(() =>
    props.effectiveMode === 'electron-window' ? t('platform.openModeWindow') : t('platform.openModeBrowser')
)

function onModeCommand(mode: UserToggleableMode) {
  emit('change-mode', mode)
}
</script>

<template>
  <div class="system-card" @click="emit('open', system)">
    <!-- 右上角:打開方式(iframe 系統顯示靜態標籤,其餘顯示下拉選擇);
         用 el-tag 當觸發器,跟下方 SSO 標籤同一套元件,視覺才統一 -->
    <div class="corner-mode" @click.stop>
      <el-tag v-if="!toggleable" effect="plain" size="small" type="primary">
        {{ t('platform.openModeIframe') }}
      </el-tag>
      <el-dropdown v-else popper-class="system-card-mode-menu" trigger="click" @command="onModeCommand">
        <el-tag class="mode-trigger-tag" effect="plain" size="small" type="info">
          <span class="mode-trigger-inner">
            {{ modeLabel }}
            <el-icon :size="10"><CaretBottom/></el-icon>
          </span>
        </el-tag>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item
                :class="{'is-active': effectiveMode === 'electron-window'}"
                command="electron-window"
            >
              {{ t('platform.openModeWindow') }}
            </el-dropdown-item>
            <el-dropdown-item
                :class="{'is-active': effectiveMode === 'external-browser'}"
                command="external-browser"
            >
              {{ t('platform.openModeBrowser') }}
            </el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </div>

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

      <!-- 原文：SSO 直通 -->
      <div v-if="system.ssoEnabled" class="card-tags">
        <el-tag effect="light" size="small" type="success">
          {{ t('platform.tagSso') }}
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

/* 右上角打開方式標籤/下拉 —— 對齊卡片自身 18px 內距，跟其他角落元素同一節奏 */
.corner-mode {
  position: absolute;
  top: 14px;
  right: 14px;
  cursor: default;
}

.mode-trigger-tag {
  cursor: pointer;
  transition: opacity 0.15s ease;
}

.mode-trigger-tag:hover {
  opacity: 0.8;
}

.mode-trigger-inner {
  display: inline-flex;
  align-items: center;
  gap: 3px;
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

/* 只有標題這一行需要讓開右上角標籤（描述/標籤都在標籤下方，不會重疊），
   避免整塊都預留空間把標題擠成一小段 */
.card-name {
  font-size: 15px;
  font-weight: 600;
  color: var(--app-text-primary);
  margin-bottom: 4px;
  letter-spacing: -0.005em;
  padding-right: 84px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
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
  align-items: center;
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

<!--
  el-dropdown 的選單是 teleport 到 body 外的 popper,不在本組件 DOM 樹內,
  scoped 樣式碰不到;靠 popper-class="system-card-mode-menu" 掛全局樣式標記目前選中項。
-->
<style>
.system-card-mode-menu .el-dropdown-menu__item.is-active {
  color: var(--el-color-primary, #409eff);
  font-weight: 600;
}
</style>
