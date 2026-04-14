<script setup lang="ts">
/**
 * 安全 iframe 容器組件
 *
 * 用於在應用內嵌入公司內部系統頁面。
 *
 * 安全配置說明（sandbox 屬性）：
 *  - allow-scripts      ：允許 iframe 內執行 JS（內部系統需要）
 *  - allow-same-origin  ：允許 iframe 訪問其自身源的 Cookie/Storage
 *  - allow-forms        ：允許表單提交（登錄表單等）
 *  - allow-popups       ：允許彈出新窗口（部分系統功能需要）
 *  - 不包含 allow-top-navigation：防止 iframe 劫持主窗口導航
 *  - 不包含 allow-modals：防止 iframe 顯示原生 alert/confirm
 *
 * 使用場景：統一平台頁面中的系統嵌入
 */

import { ref, watch } from 'vue'
import {Loading} from "@element-plus/icons-vue";

const props = defineProps<{
  /** iframe 加載的 URL */
  src: string
  /** iframe 標題（無障礙屬性） */
  title: string
  /** 是否允許全屏（默認 true） */
  allowFullscreen?: boolean
}>()

/** iframe 是否正在加載中 */
const isLoading = ref(true)
/** 加載是否失敗 */
const loadError = ref(false)

/** 當 src 變化時重置加載狀態 */
watch(
  () => props.src,
  () => {
    isLoading.value = true
    loadError.value = false
  }
)

/** iframe load 事件：加載完成 */
function onLoad() {
  isLoading.value = false
  loadError.value = false
}

/** iframe error 事件：加載失敗（如網絡不通、CSP 阻止等） */
function onError() {
  isLoading.value = false
  loadError.value = true
}
</script>

<template>
  <div class="iframe-container">
    <!-- 加載中遮罩 -->
    <div v-if="isLoading" class="iframe-loading">
      <el-icon :size="32" class="loading-icon"><Loading /></el-icon>
      <p>正在加載頁面...</p>
    </div>

    <!-- 加載失敗提示 -->
    <div v-if="loadError" class="iframe-error">
      <el-result
        icon="warning"
        title="頁面加載失敗"
        sub-title="請確認系統地址是否可訪問，或嘗試在外部瀏覽器中打開"
      />
    </div>

    <!-- 實際 iframe -->
    <iframe
      v-if="!loadError"
      :src="src"
      :title="title"
      :allowfullscreen="allowFullscreen !== false"
      class="system-iframe"
      :class="{ 'iframe-hidden': isLoading }"
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads"
      referrerpolicy="no-referrer-when-downgrade"
      @load="onLoad"
      @error="onError"
    />
  </div>
</template>

<style scoped>
.iframe-container {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: var(--el-bg-color-page);
}

/* 加載中遮罩 */
.iframe-loading {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  background: var(--el-bg-color-page);
  color: var(--el-text-color-secondary);
  z-index: 10;
}

.loading-icon {
  color: var(--el-color-primary);
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* 加載失敗提示 */
.iframe-error {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* iframe 元素 */
.system-iframe {
  width: 100%;
  height: 100%;
  border: none;
  display: block;
  transition: opacity 0.3s;
}

/* 加載中時隱藏 iframe（避免白閃） */
.iframe-hidden {
  opacity: 0;
}
</style>
