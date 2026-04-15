<script setup lang="ts">
/**
 * BPM 負責人查詢頁面
 *
 * 將 Dify 聊天機器人以 iframe 形式嵌入，供使用者查詢 BPM 表單負責人。
 * Dify embed URL 由 app-config.json → aiQuickFunctions.tools[bpmUserFinder].url 管理，
 * 修改 URL 只需改配置文件，無需動代碼。
 */
import { ArrowLeft, ChromeFilled } from '@element-plus/icons-vue'
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import IframeContainer from '@/components/common/IframeContainer.vue'
import { useConfigStore } from '@/stores/config.store'

const router = useRouter()
const configStore = useConfigStore()

/** 從 config 找到 bpmUserFinder 工具的 Dify embed URL */
const difyUrl = computed<string | undefined>(
  () => configStore.aiConfig?.tools.find((tool) => tool.id === 'bpmUserFinder')?.url
)

function goBack() {
  router.push({ name: 'ai-quick-functions' })
}

function openInBrowser() {
  if (!difyUrl.value) return
  window.open(difyUrl.value, '_blank')
}
</script>

<template>
  <div class="bpm-finder-view">
    <div class="toolbar">
      <el-button :icon="ArrowLeft" text @click="goBack">返回</el-button>
      <span class="toolbar-title">BPM 負責人查詢</span>
      <div class="toolbar-spacer" />
      <el-button v-if="difyUrl" text :icon="ChromeFilled" @click="openInBrowser">在瀏覽器開啟</el-button>
    </div>

    <div class="iframe-wrapper">
      <IframeContainer
        v-if="difyUrl"
        :src="difyUrl"
        title="BPM Finder"
      />

      <el-empty
        v-else
        description="尚未設定 Dify 網址，請在 app-config.json 的 aiQuickFunctions.tools[bpmUserFinder].url 中填入正確的 URL"
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
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--el-border-color-lighter);
  flex-shrink: 0;
}

.toolbar-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.toolbar-spacer {
  flex: 1;
}

.iframe-wrapper {
  flex: 1;
  overflow: hidden;
  min-height: 0;
}
</style>
