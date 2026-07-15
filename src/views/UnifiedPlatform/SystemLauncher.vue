<script setup lang="ts">
/**
 * 系統啟動器組件（iframe 嵌入視圖）
 *
 * 當用戶點擊系統卡片並選擇 iframe 模式時，
 * 此組件負責：
 *  1. 構建最終 URL（SSO 模式下注入 Token）
 *  2. 在 IframeContainer 中加載系統
 *  3. 提供返回列表和在外部瀏覽器打開的操作
 */

import {computed} from 'vue'
import {useI18n} from 'vue-i18n'
import {ArrowLeft, ChromeFilled} from '@element-plus/icons-vue'
import {useAuthStore} from '@/stores/auth.store'
import {useConfigText} from '@/shared/composables/useConfigText'
import IframeContainer from '@/components/common/IframeContainer.vue'
import type {SystemLink} from '@shared/types/config'

const props = defineProps<{
  /** 當前打開的系統配置 */
  system: SystemLink
}>()

const emit = defineEmits<{
  /** 返回系統列表 */
  (e: 'back'): void
}>()

const authStore = useAuthStore()
const {t} = useI18n()
const {ct} = useConfigText()

/** 顯示用名稱（用於工具欄和 iframe title） */
const displayName = computed(() => ct(`config.systems.${props.system.id}.name`, props.system.name))

/**
 * 構建最終加載 URL
 * SSO 模式下將 Token 注入查詢參數：
 *   https://erp.company.internal?sso_token=<JWT>
 */
const finalUrl = computed(() => {
  const { url, ssoEnabled, ssoTokenParam } = props.system

  if (ssoEnabled && ssoTokenParam && authStore.accessToken) {
    const separator = url.includes('?') ? '&' : '?'
    return `${url}${separator}${ssoTokenParam}=${encodeURIComponent(authStore.accessToken)}`
  }

  return url
})

/** 在系統默認瀏覽器中打開（通過 Electron shell.openExternal） */
function openInBrowser() {
  // window.open 在 Electron 中通過 setWindowOpenHandler 攔截並調用 shell.openExternal
  window.open(finalUrl.value, '_blank')
}
</script>

<template>
  <div class="system-launcher">
    <!-- 頂部工具欄 -->
    <div class="launcher-toolbar">
      <el-button text :icon="ArrowLeft" @click="emit('back')">
        {{ t('platform.backToList') }}
      </el-button>

      <div class="toolbar-center">
        <span class="system-name">{{ displayName }}</span>
        <el-tag v-if="system.ssoEnabled" size="small" type="success" effect="light">
          {{ t('platform.tagSsoEnabled') }}
        </el-tag>
      </div>

      <el-button text :icon="ChromeFilled" @click="openInBrowser">
        {{ t('platform.openInBrowser') }}
      </el-button>
    </div>

    <!-- iframe 嵌入區域 -->
    <div class="launcher-content">
      <IframeContainer :src="finalUrl" :title="displayName" />
    </div>
  </div>
</template>

<style scoped>
.system-launcher {
  display: flex;
  flex-direction: column;
  height: 100%;
}

/* 頂部工具欄 */
.launcher-toolbar {
  display: flex;
  align-items: center;
  height: 48px;
  padding: 0 16px;
  background: var(--el-bg-color);
  border-bottom: 1px solid var(--el-border-color-lighter);
  gap: 12px;
  flex-shrink: 0;
}

.toolbar-center {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.system-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

/* iframe 內容區佔滿剩餘高度 */
.launcher-content {
  flex: 1;
  overflow: hidden;
}
</style>
