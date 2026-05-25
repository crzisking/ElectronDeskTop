<script setup lang="ts">
/**
 * 每小時活動分布堆疊柱狀圖 (ECharts)
 */
import '@/features/work-collect/echarts-setup'
import VChart from 'vue-echarts'
import { toRef } from 'vue'
import { useI18n } from 'vue-i18n'
import type { WorkRecord } from '../types'
import { useHourlyStackedOption } from '../composables/useChartOptions'

const props = defineProps<{
  records: WorkRecord[]
  startHour: number
  endHour: number
}>()

const { t } = useI18n()
const recordsRef = toRef(props, 'records')
const option = useHourlyStackedOption(recordsRef, props.startHour, props.endHour)
</script>

<template>
  <div class="hourly-bar">
    <div class="hourly-bar__title">{{ t('workCollect.chartHourly') }}</div>
    <VChart
      class="hourly-bar__chart"
      :option="option"
      autoresize
    />
  </div>
</template>

<style scoped>
.hourly-bar {
  padding: 16px 18px 8px;
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 10px;
}

.hourly-bar__title {
  font-size: 14px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  margin-bottom: 10px;
}

.hourly-bar__chart {
  width: 100%;
  height: 220px;
}
</style>
