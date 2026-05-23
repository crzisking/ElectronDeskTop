<script setup lang="ts">
/**
 * 週檢視統計卡片
 */
import { computed } from 'vue'
import { Calendar, Clock, Histogram, Trophy } from '@element-plus/icons-vue'
import { CATEGORY_LABEL } from '../category-colors'
import type { WorkCategory, WorkRecord } from '../types'

const props = defineProps<{
  records: WorkRecord[]
}>()

/** 覆盖的天数 */
const coveredDays = computed(() => {
  const days = new Set<string>()
  for (const r of props.records) {
    const d = new Date(r.capturedAt)
    days.add(`${d.getMonth() + 1}/${d.getDate()}`)
  }
  return days.size
})

/** 本周最多类别 */
const topCategory = computed<{ label: string; count: number } | null>(() => {
  if (props.records.length === 0) return null
  const counts = new Map<WorkCategory, number>()
  for (const r of props.records) counts.set(r.category, (counts.get(r.category) ?? 0) + 1)
  let topCat: WorkCategory = 'other'
  let topCount = 0
  for (const [cat, count] of counts) {
    if (count > topCount) {
      topCat = cat
      topCount = count
    }
  }
  return { label: CATEGORY_LABEL[topCat], count: topCount }
})

/** 最高采集日 */
const topDay = computed<{ day: string; count: number } | null>(() => {
  if (props.records.length === 0) return null
  const dayCounts = new Map<string, number>()
  for (const r of props.records) {
    const d = new Date(r.capturedAt)
    const key = `${d.getMonth() + 1}/${d.getDate()}`
    dayCounts.set(key, (dayCounts.get(key) ?? 0) + 1)
  }
  let maxCount = 0
  let maxDay = ''
  for (const [day, count] of dayCounts) {
    if (count > maxCount) {
      maxCount = count
      maxDay = day
    }
  }
  return { day: maxDay, count: maxCount }
})
</script>

<template>
  <div class="week-stat-cards">
    <div class="stat-card">
      <el-icon class="stat-card__icon" :size="18"><Calendar /></el-icon>
      <div class="stat-card__body">
        <div class="stat-card__value">{{ records.length }}</div>
        <div class="stat-card__label">本週採集</div>
      </div>
    </div>

    <div class="stat-card">
      <el-icon class="stat-card__icon" :size="18"><Clock /></el-icon>
      <div class="stat-card__body">
        <div class="stat-card__value">{{ coveredDays }}<span class="unit">天</span></div>
        <div class="stat-card__label">覆蓋天數</div>
      </div>
    </div>

    <div class="stat-card">
      <el-icon class="stat-card__icon" :size="18"><Histogram /></el-icon>
      <div class="stat-card__body">
        <div class="stat-card__value">
          <template v-if="topCategory">
            {{ topCategory.label }}
            <span class="unit">{{ topCategory.count }}筆</span>
          </template>
          <template v-else>—</template>
        </div>
        <div class="stat-card__label">主要類別</div>
      </div>
    </div>

    <div class="stat-card">
      <el-icon class="stat-card__icon" :size="18"><Trophy /></el-icon>
      <div class="stat-card__body">
        <div class="stat-card__value">
          <template v-if="topDay">
            {{ topDay.day }}
            <span class="unit">{{ topDay.count }}筆</span>
          </template>
          <template v-else>—</template>
        </div>
        <div class="stat-card__label">最高採集日</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.week-stat-cards {
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
  .week-stat-cards {
    grid-template-columns: repeat(2, 1fr);
  }
}
</style>
