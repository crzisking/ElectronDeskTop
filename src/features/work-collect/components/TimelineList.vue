<script setup lang="ts">
/**
 * 採集紀錄時間軸列表(從原 WorkCollectView 抽出)。
 *
 * 接收**全部已載入的 records**(store.records),內部按 selectedRange 過濾顯示。
 * 預設範圍 = [今日 00:00, 今日 23:59];使用者透過 el-date-picker(daterange)切換任意區間。
 * 禁止選未來日期。
 */
import {computed, ref} from 'vue'
import {useI18n} from 'vue-i18n'
import {CATEGORY_LABEL_KEY, CATEGORY_TAG_TYPE} from '../category-colors'
import type {WorkRecord} from '../types'

const props = withDefaults(
  defineProps<{
    records: WorkRecord[]
    loading?: boolean
  }>(),
  {loading: false}
)

const {t} = useI18n()

/** 預設範圍:今日 00:00 ~ 今日 23:59 */
function defaultRange(): [Date, Date] {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const end = new Date()
  end.setHours(23, 59, 59, 999)
  return [start, end]
}

/** 選定日期區間;el-date-picker daterange 綁定 [start, end] 兩個 Date */
const selectedRange = ref<[Date, Date]>(defaultRange())

/** 按 selectedRange 過濾 records(start 取當日 00:00,end 取當日 23:59,容錯 picker 給的 time 部分) */
const filteredRecords = computed(() => {
  const [from, to] = selectedRange.value
  const start = new Date(from)
  start.setHours(0, 0, 0, 0)
  const end = new Date(to)
  end.setHours(23, 59, 59, 999)
  return props.records.filter(
      (r) => r.capturedAt >= start.getTime() && r.capturedAt <= end.getTime()
  )
})

/** 禁止選未來日期(尚未發生,選了一定空) */
function disabledDate(time: Date): boolean {
  return time.getTime() > Date.now()
}

/** Unix ms 格式化:同一天只顯示 HH:mm,跨天加 MM/DD 前綴 */
function formatTime(ms: number): string {
  const d = new Date(ms)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  // 區間若跨天,前綴加 MM/DD 讓使用者分得清楚是哪天
  if (!isSameDay(selectedRange.value[0], selectedRange.value[1])) {
    return `${d.getMonth() + 1}/${d.getDate()} ${hh}:${mm}`
  }
  return `${hh}:${mm}`
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear()
      && a.getMonth() === b.getMonth()
      && a.getDate() === b.getDate()
}
</script>

<template>
  <el-card class="timeline-card" shadow="never" v-loading="loading">
    <template #header>
      <div class="timeline-card__header">
        <span class="timeline-card__title">{{ t('workCollect.timelineTitle') }}</span>
        <el-date-picker
            v-model="selectedRange"
            :clearable="false"
            :disabled-date="disabledDate"
            :end-placeholder="t('workCollect.timelineRangeEnd')"
            :start-placeholder="t('workCollect.timelineRangeStart')"
            class="timeline-card__date"
            range-separator="—"
            size="small"
            type="daterange"
            unlink-panels
        />
        <span class="timeline-card__count">
          {{ t('workCollect.timelineCount', {count: filteredRecords.length}) }}
        </span>
      </div>
    </template>

    <el-empty
        v-if="!filteredRecords.length && !loading"
        :description="t('workCollect.timelineEmpty')"
    />

    <el-timeline v-else>
      <el-timeline-item
          v-for="rec in filteredRecords"
        :key="rec.id"
        :timestamp="formatTime(rec.capturedAt)"
        placement="top"
      >
        <div class="record-row">
          <el-tag :type="CATEGORY_TAG_TYPE[rec.category]" size="small">
            {{ t(CATEGORY_LABEL_KEY[rec.category]) }}
          </el-tag>
          <span class="record-desc">{{ rec.description }}</span>
        </div>
        <div v-if="rec.activeWindowTitle" class="record-meta">
          {{ t('workCollect.timelineForeground', { title: rec.activeWindowTitle }) }}
        </div>
      </el-timeline-item>
    </el-timeline>
  </el-card>
</template>

<style scoped>
.timeline-card {
  border-radius: 12px;
}

.timeline-card__header {
  display: flex;
  align-items: center;
  gap: 12px;
}

.timeline-card__title {
  font-size: 16px;
  font-weight: 600;
}

.timeline-card__date {
  /* DatePicker 自帶寬度,給點 margin 跟標題 / 計數區隔 */
  margin-left: 4px;
}

.timeline-card__count {
  margin-left: auto;
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
