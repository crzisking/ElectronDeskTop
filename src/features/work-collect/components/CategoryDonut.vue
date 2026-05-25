<script setup lang="ts">
/**
 * 類別佔比環形圖 (ECharts Donut)
 */
import '@/features/work-collect/echarts-setup'
import VChart from 'vue-echarts'
import { toRef } from 'vue'
import { useI18n } from 'vue-i18n'
import type { WorkRecord } from '../types'
import { useDonutOption } from '../composables/useChartOptions'

const props = defineProps<{
  records: WorkRecord[]
}>()

const { t } = useI18n()
const recordsRef = toRef(props, 'records')
const option = useDonutOption(recordsRef)
</script>

<template>
  <div class="donut-card">
    <div class="donut-card__title">{{ t('workCollect.chartCategory') }}</div>
    <VChart
      class="donut-card__chart"
      :option="option"
      autoresize
    />
  </div>
</template>

<style scoped>
.donut-card {
  padding: 16px 18px;
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 10px;
  display: flex;
  flex-direction: column;
}

.donut-card__title {
  font-size: 14px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  margin-bottom: 8px;
}

.donut-card__chart {
  width: 100%;
  height: 240px;
}
</style>
