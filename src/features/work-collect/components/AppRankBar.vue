<script setup lang="ts">
/**
 * 常用應用排名橫向柱狀圖 (ECharts Horizontal Bar)
 *
 * 根據 work_records.activeApp 統計 Top N 應用排名。
 */
import '@/features/work-collect/echarts-setup'
import VChart from 'vue-echarts'
import { toRef } from 'vue'
import type { WorkRecord } from '../types'
import { useAppRankOption } from '../composables/useChartOptions'

const props = withDefaults(
  defineProps<{
    records: WorkRecord[]
    topN?: number
  }>(),
  { topN: 5 },
)

const recordsRef = toRef(props, 'records')
const option = useAppRankOption(recordsRef, props.topN)
</script>

<template>
  <div class="app-rank">
    <div class="app-rank__title">常用應用 Top {{ topN }}</div>
    <VChart
      class="app-rank__chart"
      :option="option"
      autoresize
    />
  </div>
</template>

<style scoped>
.app-rank {
  padding: 16px 18px 8px;
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 10px;
}

.app-rank__title {
  font-size: 14px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  margin-bottom: 10px;
}

.app-rank__chart {
  width: 100%;
  height: 220px;
}
</style>
