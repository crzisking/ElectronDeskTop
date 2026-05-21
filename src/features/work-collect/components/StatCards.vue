<script setup lang="ts">
/**
 * 4 個今日統計小卡:
 *   1. 採集筆數
 *   2. 覆蓋的工時小時數(unique hours)
 *   3. 最多的類別 + 該類別佔比
 *   4. 上次採集時間
 *
 * 純讀屬性 + 計算,不訂任何事件。
 */
import {computed} from 'vue'
import {Aim, Clock, Histogram, Refresh} from '@element-plus/icons-vue'
import {CATEGORY_LABEL} from '../category-colors'
import type {WorkCategory, WorkRecord} from '../types'

const props = defineProps<{
  records: WorkRecord[]
}>()

/** 覆蓋的小時數(以採集時間的 hour 去重) */
const coveredHours = computed(() => {
  const set = new Set<number>()
  for (const r of props.records) set.add(new Date(r.capturedAt).getHours())
  return set.size
})

/** 最多類別 + 佔比 */
const topCategory = computed<{label: string; ratio: number} | null>(() => {
  if (props.records.length === 0) return null
  const counts = new Map<WorkCategory, number>()
  for (const r of props.records) counts.set(r.category, (counts.get(r.category) ?? 0) + 1)
  let topCat: WorkCategory = 'other'
  let topCount = 0
  for (const [cat, c] of counts) {
    if (c > topCount) { topCat = cat; topCount = c }
  }
  return {
    label: CATEGORY_LABEL[topCat],
    ratio: topCount / props.records.length,
  }
})

/** 上次採集時間 — HH:mm 格式;沒紀錄則 '—' */
const lastCapturedAt = computed(() => {
  if (props.records.length === 0) return '—'
  const last = props.records[props.records.length - 1]
  const d = new Date(last.capturedAt)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
})
</script>

<template>
  <div class="stat-cards">
    <div class="stat-card">
      <el-icon class="stat-card__icon" :size="18"><Aim/></el-icon>
      <div class="stat-card__body">
        <div class="stat-card__value">{{ records.length }}</div>
        <div class="stat-card__label">今日採集</div>
      </div>
    </div>

    <div class="stat-card">
      <el-icon class="stat-card__icon" :size="18"><Clock/></el-icon>
      <div class="stat-card__body">
        <div class="stat-card__value">{{ coveredHours }}<span class="unit">h</span></div>
        <div class="stat-card__label">覆蓋小時</div>
      </div>
    </div>

    <div class="stat-card">
      <el-icon class="stat-card__icon" :size="18"><Histogram/></el-icon>
      <div class="stat-card__body">
        <div class="stat-card__value">
          <template v-if="topCategory">
            {{ topCategory.label }}
            <span class="unit">{{ Math.round(topCategory.ratio * 100) }}%</span>
          </template>
          <template v-else>—</template>
        </div>
        <div class="stat-card__label">主要類別</div>
      </div>
    </div>

    <div class="stat-card">
      <el-icon class="stat-card__icon" :size="18"><Refresh/></el-icon>
      <div class="stat-card__body">
        <div class="stat-card__value">{{ lastCapturedAt }}</div>
        <div class="stat-card__label">上次採集</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.stat-cards {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
}

.stat-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 10px;
}

.stat-card__icon {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  background: var(--el-fill-color-light);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--el-text-color-primary);
  flex-shrink: 0;
}

.stat-card__body {
  min-width: 0;
}

.stat-card__value {
  font-size: 18px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  line-height: 1.2;
}

.stat-card__value .unit {
  font-size: 12px;
  font-weight: 500;
  color: var(--el-text-color-secondary);
  margin-left: 2px;
}

.stat-card__label {
  font-size: 11px;
  color: var(--el-text-color-secondary);
  margin-top: 2px;
}

@media (max-width: 720px) {
  .stat-cards {
    grid-template-columns: repeat(2, 1fr);
  }
}
</style>
