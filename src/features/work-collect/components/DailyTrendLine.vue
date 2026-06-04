<script setup lang="ts">
/**
 * 每日趨勢堆疊面積圖 (ECharts)
 *
 * 顯示過去 N 天各類別採集筆數變化趨勢。
 * Props 可控制天數，預設 7 天。
 */
import '@/features/work-collect/echarts-setup'
import VChart from 'vue-echarts'
import {toRef} from 'vue'
import {useI18n} from 'vue-i18n'
import type {WorkRecord} from '../types'
import {useDailyTrendOption} from '../composables/useChartOptions'

const props = withDefaults(
  defineProps<{
    records: WorkRecord[]
    days?: number
  }>(),
  { days: 7 },
)

const { t } = useI18n()
const recordsRef = toRef(props, 'records')
const option = useDailyTrendOption(recordsRef, props.days)
</script>

<template>
  <div class="trend-line">
    <div class="trend-line__title">{{ t('workCollect.chartTrend') }}</div>
    <VChart
      class="trend-line__chart"
      :option="option"
      autoresize
    />
  </div>
</template>

<style scoped>
.trend-line {
  padding: 16px 18px 8px;
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 10px;
}

.trend-line__title {
  font-size: 14px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  margin-bottom: 10px;
}

.trend-line__chart {
  width: 100%;
  /* lg 階高度 — 趨勢線需要最多垂直空間才看得出形狀 + 容納 legend 分頁 */
  height: var(--chart-h-lg, clamp(18rem, 42vh, 30rem));
}
</style>
