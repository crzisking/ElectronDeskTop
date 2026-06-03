<script lang="ts" setup>
/**
 * 採集健康狀態卡片 — 顯示在頂部,讓管理員一眼看到 pendingSync / 寫入失敗等異常。
 *
 * 純展示元件,父層負責拉資料 + 觸發刷新。
 */

interface WorkHealth {
  pendingSync: number
  writeFailures: number
  markFailures: number
  lastError: string | null
  lastErrorAt: number | null
}

defineProps<{
  health: WorkHealth | null
  /** Unix ms → 顯示字串(父層注入,跟主檔共用格式化函式) */
  formatTime: (ms: number) => string
}>()

const emit = defineEmits<{
  (e: 'refresh'): void
}>()
</script>

<template>
  <div v-if="health" class="health-bar">
    <span class="health-title">採集健康</span>
    <el-tag :type="health.pendingSync > 0 ? 'warning' : 'success'" effect="plain" size="small">
      待同步 {{ health.pendingSync }} 筆
    </el-tag>
    <el-tag v-if="health.writeFailures > 0" effect="plain" size="small" type="danger">
      寫入失敗 {{ health.writeFailures }}
    </el-tag>
    <el-tag v-if="health.markFailures > 0" effect="plain" size="small" type="danger">
      標記失敗 {{ health.markFailures }}
    </el-tag>
    <span v-if="health.lastError" class="health-error">
      最近異常 {{ health.lastErrorAt ? formatTime(health.lastErrorAt) : '' }} — {{ health.lastError }}
    </span>
    <el-button size="small" text @click="emit('refresh')">刷新</el-button>
  </div>
</template>

<style scoped>
.health-bar {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
  flex-shrink: 0;
  padding: 6px 10px;
  background: #f9fafb;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
}

.health-title {
  font-size: 12px;
  font-weight: 600;
  color: #6b7280;
}

.health-error {
  font-size: 12px;
  color: #d97706;
}
</style>
