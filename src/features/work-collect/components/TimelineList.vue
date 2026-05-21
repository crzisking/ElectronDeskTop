<script setup lang="ts">
/**
 * 採集紀錄時間軸列表(從原 WorkCollectView 抽出)。
 * 純展示元件,只接 records prop,不訂事件。
 */
import {CATEGORY_LABEL, CATEGORY_TAG_TYPE} from '../category-colors'
import type {WorkRecord} from '../types'

withDefaults(
  defineProps<{
    records: WorkRecord[]
    loading?: boolean
  }>(),
  {loading: false}
)

/** Unix ms 格式化成 HH:mm */
function formatTime(ms: number): string {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
</script>

<template>
  <el-card class="timeline-card" shadow="never" v-loading="loading">
    <template #header>
      <span class="timeline-card__title">採集明細</span>
      <span class="timeline-card__count">共 {{ records.length }} 筆</span>
    </template>

    <el-empty v-if="!records.length && !loading" description="今日尚無紀錄"/>

    <el-timeline v-else>
      <el-timeline-item
        v-for="rec in records"
        :key="rec.id"
        :timestamp="formatTime(rec.capturedAt)"
        placement="top"
      >
        <div class="record-row">
          <el-tag :type="CATEGORY_TAG_TYPE[rec.category]" size="small">
            {{ CATEGORY_LABEL[rec.category] }}
          </el-tag>
          <span class="record-desc">{{ rec.description }}</span>
        </div>
        <div v-if="rec.activeWindowTitle" class="record-meta">
          前台:{{ rec.activeWindowTitle }}
        </div>
      </el-timeline-item>
    </el-timeline>
  </el-card>
</template>

<style scoped>
.timeline-card {
  border-radius: 12px;
}

.timeline-card__title {
  font-size: 16px;
  font-weight: 600;
}

.timeline-card__count {
  margin-left: 12px;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.record-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.record-desc {
  font-size: 14px;
  color: var(--el-text-color-primary);
  line-height: 1.6;
}

.record-meta {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
</style>
