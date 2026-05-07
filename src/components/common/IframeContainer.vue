<script setup lang="ts">
/**
 * iframe 容器組件
 *
 * 用於在應用內嵌入公司內部系統頁面。
 *
 * 不使用 sandbox 屬性的原因：
 *   原本的 sandbox="allow-scripts allow-same-origin allow-forms allow-popups ..."
 *   按 MDN 規定，allow-scripts + allow-same-origin 兩者同時開啟時，
 *   iframe 可以移除自身的 sandbox 屬性，等同於完全沒有沙箱。
 *   既然嵌入的都是公司內部受信任系統，且必須讓所有功能正常工作，
 *   就直接不寫 sandbox，避免讓「半生不熟的沙箱配置」誤導後續維護者。
 *
 * 超時機制：
 *  iframe 不會觸發 error 事件，加載失敗時只會顯示空白。
 *  因此加入超時定時器，超過指定時間仍未 load 時顯示錯誤狀態。
 *
 * 使用場景：統一平台頁面中的系統嵌入
 */

import {onBeforeUnmount, ref, watch} from 'vue'
import {useI18n} from 'vue-i18n'
import {Loading} from '@element-plus/icons-vue'

const {t} = useI18n()

/**
 * 默認載入超時時間（毫秒）。
 * 取 30 秒：本應用主要嵌入 Dify chatbot 等第三方頁面，
 * 第三方服務冷啟動經常超過 15 秒，造成「首次進入提示加載失敗、退出再進就秒開」的體驗。
 * 如果調用方知道自己嵌入的是慢服務（例如 BI 報表），可以再上調 timeout prop。
 */
const DEFAULT_TIMEOUT = 30_000

const props = withDefaults(
    defineProps<{
      /** iframe 加載的 URL */
      src: string
      /** iframe 標題（無障礙屬性） */
      title: string
      /** 是否允許全屏（默認 true） */
      allowFullscreen?: boolean
      /** 載入超時時間（毫秒），默認 30 秒 */
      timeout?: number
    }>(),
    {timeout: DEFAULT_TIMEOUT}
)

/** iframe 是否正在加載中 */
const isLoading = ref(true)
/** 加載是否失敗 */
const loadError = ref(false)
/** 超時定時器 ID */
let timeoutTimer: ReturnType<typeof setTimeout> | null = null

/** 啟動超時定時器 */
function startTimeout() {
  clearTimeoutTimer()
  timeoutTimer = setTimeout(() => {
    if (isLoading.value) {
      isLoading.value = false
      loadError.value = true
    }
  }, props.timeout)
}

/** 清除超時定時器 */
function clearTimeoutTimer() {
  if (timeoutTimer !== null) {
    clearTimeout(timeoutTimer)
    timeoutTimer = null
  }
}

/** 當 src 變化時重置加載狀態並重新啟動超時 */
watch(
  () => props.src,
  () => {
    isLoading.value = true
    loadError.value = false
    startTimeout()
  },
    {immediate: true}
)

/** iframe load 事件：加載完成 */
function onLoad() {
  clearTimeoutTimer()
  isLoading.value = false
  loadError.value = false
}

/** iframe error 事件：加載失敗（大部分瀏覽器不會觸發，保留作為後備） */
function onError() {
  clearTimeoutTimer()
  isLoading.value = false
  loadError.value = true
}

/**
 * 「重新加載」按鈕點擊處理。
 * 通過 iframe key 強制重新掛載；同時重置 loading / error 狀態並重啟超時計時器。
 * 用於：超時失敗後讓用戶不必退出頁面就能重試。
 */
const reloadKey = ref(0)

function reload() {
  reloadKey.value++
  isLoading.value = true
  loadError.value = false
  startTimeout()
}

onBeforeUnmount(() => {
  clearTimeoutTimer()
})
</script>

<template>
  <div class="iframe-container">
    <!-- 加載中遮罩 -->
    <!-- 原文：正在加載頁面... -->
    <div v-if="isLoading" class="iframe-loading">
      <el-icon :size="32" class="loading-icon"><Loading /></el-icon>
      <p>{{ t('iframe.loading') }}</p>
    </div>

    <!-- 加載失敗提示 -->
    <!-- 原文 title：頁面加載失敗；subtitle：網絡較慢或系統暫時無法訪問，可點擊重新加載重試；btn：重新加載 -->
    <div v-if="loadError" class="iframe-error">
      <el-result
        icon="warning"
        :title="t('iframe.errorTitle')"
        :sub-title="t('iframe.errorDesc')"
      >
        <template #extra>
          <el-button type="primary" @click="reload">{{ t('iframe.reload') }}</el-button>
        </template>
      </el-result>
    </div>

    <!-- 實際 iframe（不使用 sandbox，理由見 script 區塊頂部註釋） -->
    <!-- :key="reloadKey" 用於「重新加載」按鈕觸發強制重新掛載 -->
    <iframe
      v-if="!loadError"
      :key="reloadKey"
      :src="src"
      :title="title"
      :allowfullscreen="allowFullscreen !== false"
      class="system-iframe"
      :class="{ 'iframe-hidden': isLoading }"
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
  /* 蓋住 iframe（內容層 z-index: 0），用全局 token 而非魔法數字 */
  z-index: var(--z-iframe-overlay);
}

.loading-icon {
  color: var(--el-color-primary);
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.iframe-error {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.system-iframe {
  width: 100%;
  height: 100%;
  border: none;
  display: block;
  transition: opacity 0.3s;
}

.iframe-hidden {
  opacity: 0;
}
</style>
