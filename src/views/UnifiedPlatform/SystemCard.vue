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
 * 缺失則 fallback 到 JSON 原值
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
  <!-- 竖版磁贴,与「內部功能」ToolCard 同款尺寸/结构;右上角保留打開方式選擇 -->
  <div class="app-card app-card--interactive system-card" @click="emit('open', system)">
    <!-- 頂部:系統圖標 + 右上打開方式(iframe 系統為靜態標籤,其餘為下拉) -->
    <div class="system-card__top">
      <div class="system-card__icon">
        <img
            v-if="system.iconUrl"
            :alt="displayName"
            :src="system.iconUrl"
            class="icon-img"
            @error="($event.target as HTMLImageElement).style.display = 'none'"
        />
        <!-- 圖標加載失敗或無圖標時顯示首字母 -->
        <span v-else class="icon-text">{{ displayName.charAt(0) }}</span>
      </div>

      <div class="corner-mode" @click.stop>
        <el-tag v-if="!toggleable" class="mode-tag" effect="plain" type="primary">
          {{ t('platform.openModeIframe') }}
        </el-tag>
        <el-dropdown v-else popper-class="system-card-mode-menu" trigger="click" @command="onModeCommand">
          <el-tag class="mode-tag mode-trigger-tag" effect="plain" type="info">
            <span class="mode-trigger-inner">
              {{ modeLabel }}
              <el-icon :size="13"><CaretBottom/></el-icon>
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
    </div>

    <!-- 系統名稱 + 描述 -->
    <div class="system-card__body">
      <h3 class="system-card__title">{{ displayName }}</h3>
      <p class="system-card__desc">{{ displayDesc }}</p>
    </div>

    <!-- 底部:SSO 標記(啟用時)/ 描述 + 箭頭 -->
    <div class="system-card__footer">
      <el-tag v-if="system.ssoEnabled" class="sso-tag" effect="light" size="small" type="success">
        {{ t('platform.tagSso') }}
      </el-tag>
      <span v-else class="system-card__meta">{{ displayDesc }}</span>
      <el-icon :size="16" class="system-card__arrow">
        <ArrowRight/>
      </el-icon>
    </div>
  </div>
</template>

<style scoped>
/* 尺寸/節奏對齊 components/common/ToolCard.vue,兩頁卡片視覺統一 */
.system-card {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 22px 22px 18px;
  min-height: 200px;
}

/* 頂部:圖標(左) + 打開方式(右) */
.system-card__top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.system-card__icon {
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

/* 打開方式標籤/下拉 —— 放大一號,更好點按 */
.corner-mode {
  cursor: default;
  flex-shrink: 0;
}

.mode-tag {
  height: 30px;
  padding: 0 12px;
  font-size: 13px;
  line-height: 28px;
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
  gap: 4px;
}

/* 系統名稱 + 描述 */
.system-card__body {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.system-card__title {
  font-size: 17px;
  font-weight: 600;
  color: var(--app-text-primary);
  margin: 0;
  letter-spacing: -0.005em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.system-card__desc {
  font-size: 13px;
  line-height: 1.55;
  color: var(--app-text-secondary);
  margin: 0;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* 底部:SSO 標記 / 描述 + 箭頭 */
.system-card__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding-top: 12px;
  border-top: 1px solid var(--app-border-subtle);
}

.system-card__meta {
  font-size: 12px;
  color: var(--app-text-muted);
  letter-spacing: 0.02em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}

.sso-tag {
  flex-shrink: 0;
}

.system-card__arrow {
  color: var(--app-text-muted);
  transition: transform 0.2s ease, color 0.2s ease;
  flex-shrink: 0;
}

.system-card:hover .system-card__arrow {
  color: var(--app-text-primary);
  transform: translateX(2px);
}
</style>

<!--
  el-dropdown 的選單是 teleport 到 body 外的 popper,不在本組件 DOM 樹內,
  scoped 樣式碰不到;靠 popper-class="system-card-mode-menu" 掛全局樣式標記目前選中項。
-->
<style>
/* 下拉選單本身也放大一號,跟觸發器一致 */
.system-card-mode-menu .el-dropdown-menu__item {
  font-size: 13px;
  padding: 8px 18px;
  line-height: 1.4;
}

.system-card-mode-menu .el-dropdown-menu__item.is-active {
  color: var(--el-color-primary, #409eff);
  font-weight: 600;
}
</style>
