<script setup lang="ts">
/**
 * 週檢視：每日總採集柱狀圖
 */
import '@/features/work-collect/echarts-setup'
import VChart from 'vue-echarts'
import { toRef } from 'vue'
import type { WorkRecord } from '../types'
import { useWeekDailyBarOption } from '../composables/useChartOptions'

const props = defineProps<{
  records: WorkRecord[]
}>()

const recordsRef = toRef(props, 'records')
const option = useWeekDailyBarOption(recordsRef)
</script>

<template>
  <div class="week-daily-bar">
    <div class="week-daily-bar__title">每日採集總數</div>
    <VChart
      class="week-daily-bar__chart"
      :option="option"
      autoresize
    />
  </div>
</template>

<style scoped>
.week-daily-bar {
  padding: 16px 18px 8px;
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 10px;
}

.week-daily-bar__title {
  font-size: 14px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  margin-bottom: 10px;
}

.week-daily-bar__chart {
  width: 100%;
  height: 220px;
}
</style>
