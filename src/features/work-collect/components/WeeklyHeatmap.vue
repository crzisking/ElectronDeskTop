<script setup lang="ts">
/**
 * 每週活動熱力圖 (ECharts Heatmap)
 *
 * 7 行(週一~日) × N 列(工時小時)，顏色深度反映活動密度。
 * 效仿 GitHub contribution graph。
 */
import '@/features/work-collect/echarts-setup'
import VChart from 'vue-echarts'
import { toRef } from 'vue'
import type { WorkRecord } from '../types'
import { useWeeklyHeatmapOption } from '../composables/useChartOptions'

const props = defineProps<{
  records: WorkRecord[]
  startHour: number
  endHour: number
}>()

const recordsRef = toRef(props, 'records')
const option = useWeeklyHeatmapOption(recordsRef, props.startHour, props.endHour)
</script>

<template>
  <div class="weekly-heatmap">
    <div class="weekly-heatmap__title">每週活動熱力圖</div>
    <VChart
      class="weekly-heatmap__chart"
      :option="option"
      autoresize
    />
  </div>
</template>

<style scoped>
.weekly-heatmap {
  padding: 16px 18px 8px;
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 10px;
}

.weekly-heatmap__title {
  font-size: 14px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  margin-bottom: 10px;
}

.weekly-heatmap__chart {
  width: 100%;
  height: 240px;
}
</style>
