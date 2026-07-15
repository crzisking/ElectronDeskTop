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

import {ref} from 'vue'
import {ElMessage, ElMessageBox} from 'element-plus'
import {useI18n} from 'vue-i18n'
import SettingsRow from '../components/SettingsRow.vue'
import {DocumentCopy, FolderOpened, View} from '@element-plus/icons-vue'
import {logger} from '@/shared/utils/logger'

const {t} = useI18n()

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
      ElMessage.error(t('log.openFailed'))
    }
  } catch (err) {
    logger.error('呼叫 log.openFolder 失敗', 'LogSection', err)
    ElMessage.error(t('log.openFailed'))
  }
}

/**
 * 打開日誌查看器(密碼保護)。
 *
 * 流程:
 *  1. 彈密碼輸入框
 *  2. 主進程比對密碼,成功則本 session 內標記已解鎖
 *  3. 解鎖後請主進程開啟獨立子視窗
 *
 * 密碼錯誤靜默提示「密碼錯誤」,不洩漏其他細節。
 * 已解鎖 session 內再次點按鈕仍會彈密碼框 —— 防止有人離席後別人趁機開,
 * 簡單但有效。若要省事,改成「已解鎖則直接開窗」也行,看實際需求調整。
 */
async function handleOpenViewer() {
  let password: string
  try {
    const result = await ElMessageBox.prompt(t('log.viewerPrompt'), t('log.viewerTitle'), {
      confirmButtonText: t('common.confirm'),
      cancelButtonText: t('common.cancel'),
      inputType: 'password',
      inputValidator: (val) => (val ? true : t('log.viewerEmpty')),
    })
    password = result.value
  } catch {
    // 使用者取消,正常流程,不報錯
    return
  }

  try {
    const ok = await window.electronAPI.logViewer.unlock(password)
    if (!ok) {
      ElMessage.error(t('log.viewerWrongPassword'))
      logger.warn('日誌查看器密碼錯誤', 'LogSection')
      return
    }
    window.electronAPI.logViewer.openWindow()
    logger.info('使用者打開日誌查看器', 'LogSection')
  } catch (err) {
    logger.error('日誌查看器解鎖/開啟失敗', 'LogSection', err)
    ElMessage.error(t('log.viewerFailed'))
  }
}

/**
 * 複製路徑到剪貼板（給技術支援用：用戶不會打字回報路徑）。
 * 路徑只有打開過資料夾後才有；沒拿到路徑時提示用戶先點「打開」。
 */
async function copyPath() {
  if (!knownDir.value) {
    ElMessage.info(t('log.copyHint'))
    return
  }
  try {
    await navigator.clipboard.writeText(knownDir.value)
    ElMessage.success(t('log.copied'))
  } catch {
    ElMessage.error(t('log.copyFailed'))
  }
}
</script>

<template>
  <div class="log-section">
    <!-- 主功能：打開日誌資料夾 -->
    <SettingsRow
      :title="t('log.folderTitle')"
      :description="t('log.folderDesc')"
    >
      <el-button
        type="primary"
        size="small"
        :icon="FolderOpened"
        @click="handleOpen"
      >
        {{ t('log.openBtn') }}
      </el-button>
    </SettingsRow>

    <!-- 顯示路徑（首次打開後才有值） -->
    <SettingsRow
      v-if="knownDir"
      :title="t('log.pathTitle')"
      :description="t('log.pathDesc')"
      compact
    >
      <span class="path-text" :title="knownDir">{{ knownDir }}</span>
      <el-button
        size="small"
        :icon="DocumentCopy"
        @click="copyPath"
      >
        {{ t('log.copyBtn') }}
      </el-button>
    </SettingsRow>

    <!-- 保留策略 -->
    <SettingsRow :title="t('log.retentionTitle')" :description="t('log.retentionDesc')" compact>
      <span class="meta-text">{{ t('log.retentionValue') }}</span>
    </SettingsRow>

    <!-- 日誌查看器(密碼保護;按鈕對所有人可見,真要看需要密碼) -->
    <SettingsRow :title="t('log.viewerTitle')" :description="t('log.viewerDesc')">
      <el-button size="small" :icon="View" @click="handleOpenViewer">
        {{ t('log.viewerOpenBtn') }}
      </el-button>
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
