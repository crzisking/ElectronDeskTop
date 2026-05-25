<script setup lang="ts">
/**
 * 工作自動採集 — 主視圖(v3, ECharts 圖表化版)。
 *
 * 佈局:
 *   1. 頂部:返回 + 標題 + 時間視圖切換
 *   2. 設定卡:採集開關 + 規則說明
 *   3. 統計卡片群:日檢視/週檢視不同
 *   4. 主圖區:日/週檢視不同的圖表組合
 *   5. 詳細列表:按天分組顯示
 *
 * 採集 tick 訂閱在 App.vue 已 bootstrap,本頁進來只負責 refresh 載入紀錄。
 */

import {computed, onMounted, ref} from 'vue'
import {useRouter} from 'vue-router'
import {useI18n} from 'vue-i18n'
import {ArrowLeft, Monitor, VideoCamera} from '@element-plus/icons-vue'
import {ElMessage} from 'element-plus'
import {useWorkCollectStore} from './store'
import {filterTodayRecords, filterWeekRecords} from './composables/useChartOptions'
import StatCards from './components/StatCards.vue'
import WeekStatCards from './components/WeekStatCards.vue'
import HourlyStackedBar from './components/HourlyStackedBar.vue'
import CategoryDonut from './components/CategoryDonut.vue'
import DailyTrendLine from './components/DailyTrendLine.vue'
import WeeklyHeatmap from './components/WeeklyHeatmap.vue'
import AppRankBar from './components/AppRankBar.vue'
import TimelineList from './components/TimelineList.vue'
import WeekDailyBar from './components/WeekDailyBar.vue'
import WeekDailyStacked from './components/WeekDailyStacked.vue'

const router = useRouter()
const store = useWorkCollectStore()
const { t } = useI18n()

/** 時間視圖模式 */
const viewMode = ref<'day' | 'week'>('day')

/** 根據視圖模式過濾的數據 */
const filteredRecords = computed(() => {
  if (viewMode.value === 'day') {
    return filterTodayRecords(store.records)
  } else {
    return filterWeekRecords(store.records)
  }
})

function handleBack() {
  if (window.history.length > 1) router.back()
  else router.push({ name: 'personal-functions' })
}

async function onToggleChange(next: boolean) {
  try {
    await store.toggle(next)
    ElMessage.success(next ? t('workCollect.toggleOn') : t('workCollect.toggleOff'))
  } catch {
    ElMessage.error(t('workCollect.toggleFailed'))
  }
}

/** UI 標題用,顯示「採集時段 08:00-17:00」 */
const workHoursLabel = computed(() => {
  const { start, end } = store.workHours
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(start)}:00 - ${pad(end)}:00`
})

/** 趨勢圖天數:日檢視 7 天,週檢視 14天 */
const trendDays = computed(() => (viewMode.value === 'day' ? 7 : 14))

onMounted(async () => {
  await store.refresh()
})
</script>

<template>
  <div class="work-collect-view">
    <!-- ── 頂部 ──────────────────────────────────────────── -->
    <div class="header">
      <el-button text :icon="ArrowLeft" @click="handleBack">{{ t('workCollect.back') }}</el-button>
      <h2 class="title">
        <el-icon><VideoCamera /></el-icon>
        {{ t('workCollect.title') }}
      </h2>
      <div class="header__spacer" />
      <el-radio-group v-model="viewMode" size="small">
        <el-radio-button value="day">{{ t('workCollect.viewDay') }}</el-radio-button>
        <el-radio-button value="week">{{ t('workCollect.viewWeek') }}</el-radio-button>
      </el-radio-group>
    </div>

    <!-- ── 設定卡 ──────────────────────────────────────────── -->
    <el-card class="settings-card" shadow="never">
      <div class="setting-row">
        <div class="setting-info">
          <div class="label">{{ t('workCollect.enableLabel') }}</div>
          <div class="hint">
            {{ t('workCollect.enableHintBefore') }}
            <strong>{{ store.intervalMinutes }} {{ t('workCollect.unitMinutes') }}</strong>
            {{ t('workCollect.enableHintAfter') }}
          </div>
        </div>
        <el-switch
          :model-value="store.enabled"
          @update:model-value="(v: any) => onToggleChange(Boolean(v))"
          size="large"
          inline-prompt
          active-text="ON"
          inactive-text="OFF"
        />
      </div>

      <el-divider/>

      <div class="rules">
        <div class="rule">
          <el-icon><Monitor /></el-icon>
          <span v-html="t('workCollect.ruleHours', { hours: workHoursLabel })"></span>
        </div>
        <div class="rule">
          <el-icon><Monitor /></el-icon>
          {{ t('workCollect.ruleLock') }}
        </div>
      </div>
    </el-card>

    <!-- ── 日檢視 ──────────────────────────────────────────── -->
    <template v-if="viewMode === 'day'">
      <!-- 統計卡片 -->
      <StatCards :records="filteredRecords" />

      <!-- 主圖區:每小時柱狀 + 類別佔比 -->
      <div class="charts-row">
        <div class="charts-row__hourly">
          <HourlyStackedBar
            :records="filteredRecords"
            :start-hour="store.workHours.start"
            :end-hour="store.workHours.end"
          />
        </div>
        <div class="charts-row__donut">
          <CategoryDonut :records="filteredRecords" />
        </div>
      </div>

      <!-- 每日趨勢 -->
      <DailyTrendLine
        :records="store.records"
        :days="trendDays"
      />

      <!-- 熱力圖 + 應用排名 -->
      <div class="charts-row charts-row--bottom">
        <div class="charts-row__hourly">
          <WeeklyHeatmap
            :records="filteredRecords"
            :start-hour="store.workHours.start"
            :end-hour="store.workHours.end"
          />
        </div>
        <div class="charts-row__donut">
          <AppRankBar :records="filteredRecords" :top-n="5" />
        </div>
      </div>

      <!-- 詳細列表 -->
      <!-- TimelineList 接全部 records,內部按日期選擇器自行 filter,跟外層的 day/week 模式解耦 -->
      <TimelineList :loading="store.loading" :records="store.records"/>
    </template>

    <!-- ── 週檢視 ──────────────────────────────────────────── -->
    <template v-else>
      <!-- 統計卡片 -->
      <WeekStatCards :records="filteredRecords" />

      <!-- 主圖區:每日採集 + 類別佔比 -->
      <div class="charts-row">
        <div class="charts-row__hourly">
          <WeekDailyBar :records="filteredRecords" />
        </div>
        <div class="charts-row__donut">
          <CategoryDonut :records="filteredRecords" />
        </div>
      </div>

      <!-- 每日類別分佈 -->
      <WeekDailyStacked :records="filteredRecords" />

      <!-- 熱力圖 + 應用排名 -->
      <div class="charts-row charts-row--bottom">
        <div class="charts-row__hourly">
          <WeeklyHeatmap
            :records="filteredRecords"
            :start-hour="store.workHours.start"
            :end-hour="store.workHours.end"
          />
        </div>
        <div class="charts-row__donut">
          <AppRankBar :records="filteredRecords" :top-n="5" />
        </div>
      </div>

      <!-- 詳細列表 -->
      <!-- TimelineList 接全部 records,內部按日期選擇器自行 filter,跟外層的 day/week 模式解耦 -->
      <TimelineList :loading="store.loading" :records="store.records"/>
    </template>
  </div>
</template>

<style scoped>
.work-collect-view {
  padding: 24px;
  max-width: 1200px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.header {
  display: flex;
  align-items: center;
  gap: 16px;
}

.header__spacer {
  flex: 1;
}

.title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  font-size: 22px;
  font-weight: 600;
}

.settings-card {
  border-radius: 12px;
}

.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
}

.setting-info .label {
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 4px;
}

.setting-info .hint {
  font-size: 13px;
  color: var(--el-text-color-secondary);
  line-height: 1.6;
}

.rules {
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 13px;
  color: var(--el-text-color-regular);
}

.rule {
  display: flex;
  align-items: center;
  gap: 6px;
}

/* 主圖區:左 2/3 柱狀,右 1/3 donut */
/* minmax(0, Nfr) 是關鍵 ── grid item 預設 min-width: auto,內容寬就撐開不縮,
   把它改成 minmax(0, Nfr) 允許縮到任何寬度,圖表才會跟著視窗縮放 */
.charts-row {
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
  gap: 16px;
}

/* 雙重保險:每個 grid item / chart 子容器都允許縮小,讓 ECharts autoresize 抓到正確寬度 */
.charts-row > * {
  min-width: 0;
}

.charts-row--bottom {
  /* 熱力圖 + 應用排名 同一行 */
}

/* 視窗較窄時切成單欄堆疊。1100 比之前的 880 大,讓 donut 在主視窗 + sidebar 場景下提早讓位 */
@media (max-width: 1100px) {
  .charts-row {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
