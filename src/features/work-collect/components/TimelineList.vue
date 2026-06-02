<script setup lang="ts">
/**
 * 採集紀錄時間軸列表。
 *
 * 接收**全部已載入的 records**(store.records),內部依下列條件過濾 + 分頁:
 *  - 日期區間(daterange picker,預設今日)
 *  - 類別篩選(el-select multiple,預設全部)
 *  - 分頁(預設 20 筆 / 頁,可調 10 / 20 / 50 / 100)
 *
 * 並提供「匯出 TXT」一鍵下載當前過濾結果(不受分頁影響,匯整個區間)。
 */
import {computed, ref} from 'vue'
import {useI18n} from 'vue-i18n'
import {ElMessage} from 'element-plus'
import {Download} from '@element-plus/icons-vue'
import {CATEGORY_TAG_TYPE, getCategoryLabel} from '../category-colors'
import type {WorkCategory, WorkRecord} from '../types'

const props = withDefaults(
  defineProps<{
    records: WorkRecord[]
    loading?: boolean
  }>(),
  {loading: false}
)

const {t} = useI18n()

// ── 日期範圍 ────────────────────────────────────────────────────
function defaultRange(): [Date, Date] {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const end = new Date()
  end.setHours(23, 59, 59, 999)
  return [start, end]
}

/** 選定日期區間;el-date-picker daterange 綁定 [start, end] 兩個 Date */
const selectedRange = ref<[Date, Date]>(defaultRange())

/** 過濾下拉的可選分類 — 從當前 records 動態派生(模板化後 category 不固定) */
const availableCategories = computed<WorkCategory[]>(() => {
  const set = new Set<WorkCategory>()
  for (const r of props.records) set.add(r.category)
  return [...set].sort()
})

/** 禁止選未來日期 */
function disabledDate(time: Date): boolean {
  return time.getTime() > Date.now()
}

// ── 類別篩選(多選) ────────────────────────────────────────────
/** 選中的 categories;空陣列表示「全部」(對齊 placeholder UI 慣例) */
const selectedCategories = ref<WorkCategory[]>([])

// ── 分頁 ────────────────────────────────────────────────────────
const currentPage = ref(1)
const pageSize = ref(20)
const PAGE_SIZE_OPTIONS = [10, 20, 50, 100]

/**
 * 過濾後(尚未分頁)的 records,匯出 / 分頁計數都用這個。
 * 排序:最新的在最上面(capturedAt desc) —— 採集是流水帳,使用者打開時最關心
 * 「剛剛在幹嘛」,讓最新的紀錄不必滾到底才能看到。
 */
const filteredRecords = computed(() => {
  const [from, to] = selectedRange.value
  const start = new Date(from);
  start.setHours(0, 0, 0, 0)
  const end = new Date(to);
  end.setHours(23, 59, 59, 999)
  const catSet = selectedCategories.value.length ? new Set(selectedCategories.value) : null

  return props.records
      .filter((r) => {
        if (r.capturedAt < start.getTime() || r.capturedAt > end.getTime()) return false
        return !(catSet && !catSet.has(r.category))
      })
      .slice() // 不就地排序,避免污染 props.records(其他圖表還靠這個 array 算)
      .sort((a, b) => b.capturedAt - a.capturedAt)
})

/** 當前頁的 slice */
const pagedRecords = computed(() => {
  const startIdx = (currentPage.value - 1) * pageSize.value
  return filteredRecords.value.slice(startIdx, startIdx + pageSize.value)
})

/** 篩選條件變動時自動回第一頁(避免空頁) */
function resetToFirstPage() {
  currentPage.value = 1
}

// ── 工具:時間 / 日期格式化 ──────────────────────────────────────
function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear()
      && a.getMonth() === b.getMonth()
      && a.getDate() === b.getDate()
}

/** 時間軸上每筆的時間戳:同天區間只顯示 HH:mm,跨天加 MM/DD */
function formatTimestamp(ms: number): string {
  const d = new Date(ms)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  if (!isSameDay(selectedRange.value[0], selectedRange.value[1])) {
    return `${d.getMonth() + 1}/${d.getDate()} ${hh}:${mm}`
  }
  return `${hh}:${mm}`
}

/** 匯出檔名用:YYYY-MM-DD */
function formatDateForFilename(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

/** 匯出檔內每行用:YYYY-MM-DD HH:mm:ss(可讀) */
function formatTimestampForExport(ms: number): string {
  const d = new Date(ms)
  const y = d.getFullYear()
  const M = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  return `${y}-${M}-${dd} ${hh}:${mm}:${ss}`
}

// ── 匯出 TXT ────────────────────────────────────────────────────
/**
 * 匯出當前過濾結果為 TXT 檔。
 * 走 browser Blob + a.download,讓 Electron renderer 直接觸發下載到預設下載資料夾。
 * 不必額外開 IPC(若未來要「選保存位置」再做)。
 */
function exportTxt() {
  const records = filteredRecords.value
  if (records.length === 0) {
    ElMessage.warning(t('workCollect.timelineExportEmpty'))
    return
  }

  // 表頭 + 每筆一行,Tab 分隔(在 Excel 內好直接貼)
  const header = ['時間', '類別', '描述', '前台視窗'].join('\t')
  const lines = records.map((r) => {
    const time = formatTimestampForExport(r.capturedAt)
    const cat = getCategoryLabel(r.category)
    const desc = (r.description ?? '').replace(/\t/g, ' ').replace(/\n/g, ' ')
    const win = (r.activeWindowTitle ?? '').replace(/\t/g, ' ').replace(/\n/g, ' ')
    return [time, cat, desc, win].join('\t')
  })
  // UTF-8 BOM,讓 Excel / Notepad 雙擊不會亂碼
  const content = '﻿' + header + '\n' + lines.join('\n')

  const blob = new Blob([content], {type: 'text/plain;charset=utf-8'})
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  const [from, to] = selectedRange.value
  a.href = url
  a.download = `work-collect_${formatDateForFilename(from)}_to_${formatDateForFilename(to)}.txt`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)

  ElMessage.success(t('workCollect.timelineExportSuccess', {count: records.length}))
}
</script>

<template>
  <el-card class="timeline-card" shadow="never" v-loading="loading">
    <template #header>
      <div class="timeline-card__header">
        <span class="timeline-card__title">{{ t('workCollect.timelineTitle') }}</span>

        <!-- 日期範圍 -->
        <el-date-picker
            v-model="selectedRange"
            :end-placeholder="t('workCollect.timelineRangeEnd')"
            :start-placeholder="t('workCollect.timelineRangeStart')"
            :clearable="false"
            :disabled-date="disabledDate"
            size="small"
            class="timeline-card__date"
            type="daterange"
            range-separator="—"
            unlink-panels
            @change="resetToFirstPage"
        />

        <!-- 類別篩選(多選) -->
        <el-select
            v-model="selectedCategories"
            :placeholder="t('workCollect.timelineCategoryAll')"
            class="timeline-card__category"
            clearable
            collapse-tags
            collapse-tags-tooltip
            multiple
            size="small"
            @change="resetToFirstPage"
        >
          <!-- 模板化後 category 動態 — 過濾選項從當前 records 派生 -->
          <el-option
              v-for="cat in availableCategories"
              :key="cat"
              :label="getCategoryLabel(cat)"
              :value="cat"
          />
        </el-select>

        <span class="timeline-card__count">
          {{ t('workCollect.timelineCount', {count: filteredRecords.length}) }}
        </span>

        <!-- 匯出按鈕 -->
        <el-button
            :icon="Download"
            plain
            size="small"
            type="primary"
            @click="exportTxt"
        >
          {{ t('workCollect.timelineExport') }}
        </el-button>
      </div>
    </template>

    <el-empty
        v-if="!filteredRecords.length && !loading"
        :description="t('workCollect.timelineEmpty')"
    />

    <template v-else>
      <el-timeline class="timeline-card__list">
        <el-timeline-item
            v-for="rec in pagedRecords"
            :key="rec.id"
            :timestamp="formatTimestamp(rec.capturedAt)"
            placement="top"
        >
          <div class="record-row">
            <el-tag :type="CATEGORY_TAG_TYPE[rec.category]" size="small">
              {{ getCategoryLabel(rec.category) }}
            </el-tag>
            <span class="record-desc">{{ rec.description }}</span>
          </div>
          <div v-if="rec.activeWindowTitle" class="record-meta">
            {{ t('workCollect.timelineForeground', {title: rec.activeWindowTitle}) }}
          </div>
          <div v-if="rec.reason" class="record-reason">
            <span class="record-reason__label">{{ t('workCollect.timelineReasonLabel') }}:</span>
            <span class="record-reason__text">{{ rec.reason }}</span>
          </div>
        </el-timeline-item>
      </el-timeline>

      <!-- 分頁 -->
      <div class="timeline-card__pagination">
        <el-pagination
            v-model:current-page="currentPage"
            v-model:page-size="pageSize"
            :page-sizes="PAGE_SIZE_OPTIONS"
            :total="filteredRecords.length"
            background
            layout="total, sizes, prev, pager, next"
        />
      </div>
    </template>
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
  flex-wrap: wrap;
}

.timeline-card__title {
  font-size: 16px;
  font-weight: 600;
}

.timeline-card__date {
  /* daterange 自帶寬度;這裡只控制間距 */
}

.timeline-card__category {
  width: 180px;
}

.timeline-card__count {
  margin-left: auto;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.timeline-card__list {
  margin-top: 4px;
}

.timeline-card__pagination {
  display: flex;
  justify-content: flex-end;
  margin-top: 12px;
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

.record-reason {
  margin-top: 4px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  line-height: 1.5;
}

.record-reason__label {
  font-weight: 600;
  margin-right: 4px;
}

.record-reason__text {
  color: var(--el-text-color-regular);
}
</style>
