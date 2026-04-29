<script setup lang="ts">
/**
 * LogSection — 設定彈窗的「日誌與診斷」分區
 *
 * 功能：
 *  1. 顯示日誌存放路徑（從主進程 IPC 拿）
 *  2. 「打開日誌資料夾」按鈕 → 用 OS 檔案總管打開 logs 目錄
 *  3. 日誌保留天數說明（固定 14 天，於 log-file-writer.ts 設定）
 *
 * 使用場景：用戶在生產環境遇到 bug，技術支援可以指引：
 *   「設定 → 日誌與診斷 → 打開日誌資料夾，把當天的 .log 檔發過來」
 */

import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import SettingsRow from '../components/SettingsRow.vue'
import { FolderOpened, DocumentCopy } from '@element-plus/icons-vue'
import { logger } from '@/utils/logger'

/** 已知的日誌目錄（首次點擊「打開」時由主進程返回） */
const knownDir = ref<string>('')

/**
 * 打開日誌資料夾。
 * 主進程用 shell.openPath 跨平台地打開檔案總管。
 */
async function handleOpen() {
  try {
    const res = await window.electronAPI.log.openFolder()
    if (res.ok) {
      knownDir.value = res.dir
      logger.info('用戶打開日誌資料夾', 'LogSection')
    } else {
      ElMessage.error('打開日誌資料夾失敗')
    }
  } catch (err) {
    logger.error('呼叫 log.openFolder 失敗', 'LogSection', err)
    ElMessage.error('打開日誌資料夾失敗')
  }
}

/**
 * 複製路徑到剪貼板（給技術支援用：用戶不會打字回報路徑）。
 * 路徑只有打開過資料夾後才有；沒拿到路徑時提示用戶先點「打開」。
 */
async function copyPath() {
  if (!knownDir.value) {
    ElMessage.info('請先點「打開日誌資料夾」')
    return
  }
  try {
    await navigator.clipboard.writeText(knownDir.value)
    ElMessage.success('路徑已複製')
  } catch {
    ElMessage.error('複製失敗，請手動複製')
  }
}
</script>

<template>
  <div class="log-section">
    <!-- 主功能：打開日誌資料夾 -->
    <SettingsRow
      title="日誌資料夾"
      description="包含應用運行記錄，遇到問題時請打包當日的 .log 檔回報"
    >
      <el-button
        type="primary"
        size="small"
        :icon="FolderOpened"
        @click="handleOpen"
      >
        打開
      </el-button>
    </SettingsRow>

    <!-- 顯示路徑（首次打開後才有值） -->
    <SettingsRow
      v-if="knownDir"
      title="路徑"
      description="日誌資料夾的絕對路徑"
      compact
    >
      <span class="path-text" :title="knownDir">{{ knownDir }}</span>
      <el-button
        size="small"
        :icon="DocumentCopy"
        @click="copyPath"
      >
        複製
      </el-button>
    </SettingsRow>

    <!-- 保留策略 -->
    <SettingsRow title="保留策略" description="超過 14 天的舊日誌會自動清理" compact>
      <span class="meta-text">14 天</span>
    </SettingsRow>
  </div>
</template>

<style scoped>
.log-section {
  display: flex;
  flex-direction: column;
}

.path-text {
  font-family: var(--app-font-mono);
  font-size: 11px;
  color: var(--app-text-secondary);
  background: var(--app-bg-elevated);
  border: 1px solid var(--app-border-subtle);
  border-radius: 6px;
  padding: 4px 8px;
  max-width: 280px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  display: inline-block;
}

.meta-text {
  font-size: 13px;
  color: var(--app-text-secondary);
}
</style>
