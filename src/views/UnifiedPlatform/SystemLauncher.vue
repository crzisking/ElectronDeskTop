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

import { computed } from 'vue'
import { useAuthStore } from '@/stores/auth.store'
import IframeContainer from '@/components/common/IframeContainer.vue'
import type { SystemLink } from '@/types/config.types'

const props = defineProps<{
  /** 當前打開的系統配置 */
  system: SystemLink
}>()

const emit = defineEmits<{
  /** 返回系統列表 */
  (e: 'back'): void
}>()

const authStore = useAuthStore()

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
      <!-- 返回按鈕 -->
      <el-button text :icon="ArrowLeft" @click="emit('back')">
        返回系統列表
      </el-button>

      <div class="toolbar-center">
        <span class="system-name">{{ system.name }}</span>
        <el-tag v-if="system.ssoEnabled" size="small" type="success" effect="light">
          SSO 已啟用
        </el-tag>
      </div>

      <!-- 在瀏覽器打開 -->
      <el-button text :icon="ChromeFilled" @click="openInBrowser">
        在瀏覽器打開
      </el-button>
    </div>

    <!-- iframe 嵌入區域 -->
    <div class="launcher-content">
      <IframeContainer :src="finalUrl" :title="system.name" />
    </div>
  </div>
</template>

<script lang="ts">
// 需要從 icons 導入（非 setup 區域，避免 setup 中 import 衝突）
import { ArrowLeft, ChromeFilled } from '@element-plus/icons-vue'
export default { components: { ArrowLeft, ChromeFilled } }
</script>

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
