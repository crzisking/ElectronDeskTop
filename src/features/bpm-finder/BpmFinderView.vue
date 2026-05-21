<script setup lang="ts">
/**
 * BPM 負責人查詢頁面
 *
 * 將 Dify 聊天機器人以 iframe 形式嵌入，供使用者查詢 BPM 表單負責人。
 * Dify embed URL 由 app-config.json → internalFunctions.tools[bpmUserFinder].url 管理，
 * 修改 URL 只需改配置文件，無需動代碼。
 */
import { ArrowLeft, ChromeFilled } from '@element-plus/icons-vue'
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import {useI18n} from 'vue-i18n'
import IframeContainer from '@/components/common/IframeContainer.vue'
import { useConfigStore } from '@/stores/config.store'

const router = useRouter()
const configStore = useConfigStore()
const {t} = useI18n()

/** 從 config 找到 bpmUserFinder 工具的 Dify embed URL */
const difyUrl = computed<string | undefined>(
  () => configStore.functionsConfig?.tools.find((tool) => tool.id === 'bpmUserFinder')?.url
)

function goBack() {
  router.push({ name: 'internal-functions' })
}

function openInBrowser() {
  if (!difyUrl.value) return
  window.open(difyUrl.value, '_blank')
}
</script>

<template>
  <div class="bpm-finder-view">
    <!-- 原文：返回 / BPM 負責人查詢 / 在瀏覽器開啟 -->
    <div class="toolbar">
      <el-button :icon="ArrowLeft" text @click="goBack">{{ t('repair.back') }}</el-button>
      <span class="toolbar-title">{{ t('ai.bpmFinder.title') }}</span>
      <div class="toolbar-spacer" />
      <el-button v-if="difyUrl" text :icon="ChromeFilled" @click="openInBrowser">{{ t('ai.bpmFinder.openInBrowserBtn') }}</el-button>
    </div>

    <div class="iframe-wrapper">
      <IframeContainer
        v-if="difyUrl"
        :src="difyUrl"
        title="BPM Finder"
      />

      <!-- 原文：尚未設定 Dify 網址，請在 app-config.json 的 internalFunctions.tools[bpmUserFinder].url 中填入正確的 URL -->
      <el-empty
        v-else
        :description="t('ai.bpmFinder.urlNotConfigured')"
        :image-size="120"
      />
    </div>
  </div>
</template>

<style scoped>
.bpm-finder-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  box-sizing: border-box;
  background: var(--app-bg-surface);
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 24px;
  border-bottom: 1px solid var(--app-border-subtle);
  background: var(--app-bg-surface);
  flex-shrink: 0;
}

.toolbar-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--app-text-primary);
  letter-spacing: -0.005em;
}

.toolbar-spacer {
  flex: 1;
}

.iframe-wrapper {
  flex: 1;
  overflow: hidden;
  min-height: 0;
  background: var(--app-bg-surface);
}
</style>
