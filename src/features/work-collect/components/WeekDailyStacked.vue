<script setup lang="ts">
/**
 * 週檢視：每日類別分佈堆疊柱狀圖
 */
import '@/features/work-collect/echarts-setup'
import VChart from 'vue-echarts'
import { toRef } from 'vue'
import type { WorkRecord } from '../types'
import { useWeekDailyStackedOption } from '../composables/useChartOptions'

const props = defineProps<{
  records: WorkRecord[]
}>()

const recordsRef = toRef(props, 'records')
const option = useWeekDailyStackedOption(recordsRef)
</script>

<template>
  <div class="week-daily-stacked">
    <div class="week-daily-stacked__title">每日類別分佈</div>
    <VChart
      class="week-daily-stacked__chart"
      :option="option"
      autoresize
    />
  </div>
</template>

<style scoped>
.week-daily-stacked {
  padding: 16px 18px 8px;
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 10px;
}

.week-daily-stacked__title {
  font-size: 14px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  margin-bottom: 10px;
}

.week-daily-stacked__chart {
  width: 100%;
  height: 260px;
}
</style>
