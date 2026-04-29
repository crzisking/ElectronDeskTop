<script setup lang="ts">
/**
 * UpdateSection — 設定彈窗的「軟體更新」分區
 *
 * 功能：
 *  1. 顯示當前版本號（從 configStore.appConfig.version 讀取）
 *  2. 顯示自動檢測時刻（每天 HH:MM）
 *  3. 「檢查更新」按鈕，呼叫 useUpdate.manualCheck()
 *  4. 根據 useUpdate.state 顯示動態狀態：
 *     - checking      → 旋轉 loading + 「檢查中…」
 *     - downloading   → 進度百分比
 *     - downloaded    → 「已下載完成，等待重啟」+ 立即重啟按鈕
 *     - error         → 紅字錯誤
 *
 * 狀態完全由 useUpdate composable 提供，本組件只是它的 UI 視圖層。
 */

import { computed } from 'vue'
import { useConfigStore } from '@/stores/config.store'
import { useUpdate } from '@/composables/useUpdate'
import SettingsRow from '../components/SettingsRow.vue'
import { Loading, Refresh } from '@element-plus/icons-vue'

const configStore = useConfigStore()
const { state, progress, availableInfo, lastError, manualCheck, install } = useUpdate()

/** 當前版本（讀 app-config.json 的 version 字段） */
const currentVersion = computed(() => configStore.appConfig?.version ?? '—')

/** 每日定時檢查時刻（讀配置裡的 update.dailyCheckTime） */
const dailyCheckTime = computed(() => {
  const t = configStore.appConfig?.update?.dailyCheckTime
  return t && t.trim() !== '' ? t : '未啟用'
})

/** 自動更新總開關當前狀態 */
const updateEnabled = computed(() => configStore.appConfig?.update?.enabled ?? false)

/** 「檢查更新」按鈕是否禁用（檢查中 / 下載中時禁用，避免重複觸發） */
const checking = computed(() => state.value === 'checking')
const downloading = computed(() => state.value === 'downloading')
const checkDisabled = computed(() => checking.value || downloading.value)

/** 下載進度百分比文字 */
const progressText = computed(() => {
  if (state.value !== 'downloading') return ''
  return `${progress.value.percent.toFixed(0)}%`
})
</script>

<template>
  <div class="update-section">
    <!-- 當前版本 -->
    <SettingsRow title="當前版本" description="您目前使用的應用版本號">
      <span class="version-tag">v {{ currentVersion }}</span>
    </SettingsRow>

    <!-- 自動檢查時間 -->
    <SettingsRow
      v-if="updateEnabled"
      title="自動檢查"
      description="每天定時自動檢查並下載新版本"
    >
      <span class="meta-text">{{ dailyCheckTime }}</span>
    </SettingsRow>

    <!-- 手動檢查更新（核心功能） -->
    <SettingsRow title="檢查更新" description="立即連線伺服器查詢是否有新版本">
      <!-- 下載中：顯示進度 -->
      <template v-if="downloading">
        <span class="status-text downloading">
          <el-icon class="is-loading"><Loading /></el-icon>
          下載中 {{ progressText }}
        </span>
      </template>

      <!-- 已下載完成：顯示重啟按鈕 -->
      <template v-else-if="state === 'downloaded'">
        <span class="status-text success">
          {{ availableInfo?.version ? `v ${availableInfo.version} 已就緒` : '已就緒' }}
        </span>
        <el-button type="primary" size="small" @click="install">立即重啟</el-button>
      </template>

      <!-- 錯誤：顯示錯誤文字 + 重試 -->
      <template v-else-if="state === 'error'">
        <span class="status-text error">{{ lastError }}</span>
        <el-button size="small" :icon="Refresh" @click="manualCheck">重試</el-button>
      </template>

      <!-- 預設：顯示「檢查更新」按鈕 -->
      <template v-else>
        <el-button
          type="primary"
          size="small"
          :icon="checking ? Loading : Refresh"
          :loading="checking"
          :disabled="checkDisabled"
          @click="manualCheck"
        >
          {{ checking ? '檢查中…' : '檢查更新' }}
        </el-button>
      </template>
    </SettingsRow>
  </div>
</template>

<style scoped>
.update-section {
  display: flex;
  flex-direction: column;
}

.version-tag {
  font-family: var(--app-font-mono);
  font-size: 12px;
  font-weight: 600;
  color: var(--app-text-primary);
  background: var(--app-bg-elevated);
  border: 1px solid var(--app-border-subtle);
  border-radius: 999px;
  padding: 4px 12px;
  letter-spacing: 0.04em;
}

.meta-text {
  font-size: 13px;
  color: var(--app-text-secondary);
  font-variant-numeric: tabular-nums;
}

.status-text {
  font-size: 12px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.status-text.downloading {
  color: var(--app-text-secondary);
}

.status-text.success {
  color: var(--app-success);
  font-weight: 500;
}

.status-text.error {
  color: var(--app-danger);
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
