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
import {ArrowLeft, MagicStick, Monitor, VideoCamera} from '@element-plus/icons-vue'
import {ElMessage} from 'element-plus'
import {useWorkCollectStore} from './store'
// ElMessage 留給 onToggleChange 用 — 採集開關失敗時提示
import {useWorkAnalysisStore} from './analysis/store'
import AnalysisCard from './analysis/AnalysisCard.vue'
import AnalysisDialog from './analysis/AnalysisDialog.vue'
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

/**
 * embedded:嵌在 LogViewer tab 內時為 true。
 *  - 隱藏「返回」按鈕(LogViewer 無 router)
 *  - 隱藏內層標題(LogViewer 側欄已標示「工作採集」,再加一行 H2 是視覺重複)
 * 主視窗本來不會渲染此 view(階段一已移除路由),保留 prop 留個逃生口。
 */
const props = defineProps<{ embedded?: boolean }>()

const store = useWorkCollectStore()
const analysisStore = useWorkAnalysisStore()
const router = useRouter()
const { t } = useI18n()

/** AnalysisDialog 開關 — 點「分析工作」按鈕觸發 */
const analysisDialogVisible = ref(false)

/**
 * 返回按鈕:優先走 router.back() 還原使用者來時路徑;
 * 若是直接 URL 進來(history.length=1)沒處可退 → fallback 到個人功能入口。
 * embedded 模式(舊 LogViewer 容器)沒 router 概念,按鈕直接隱藏。
 */
function goBack() {
  if (window.history.length > 1) {
    router.back()
  } else {
    router.push({name: 'personal-functions'}).catch(() => undefined)
  }
}

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

/**
 * 每週活動熱力圖固定吃本週紀錄,不隨 day/week 切換。
 * 圖名本來就是「每週」,在日檢視下也該顯示完整一週的活動分佈,
 * 否則日檢視只剩今天一列、其他六列全空,圖意義全失。
 */
const weeklyHeatmapRecords = computed(() => filterWeekRecords(store.records))

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
  // 工作採集流水線 + 分析報告平行載入 — 兩者無依賴關係
  await Promise.all([
    store.refresh(),
    analysisStore.bootstrap(),
  ])
})

/**
 * 點「分析工作」按鈕 — 開 AnalysisDialog,內部三階段(配置 → 流式 → 報告)。
 * 所有提示詞 / model / 時間範圍編輯都在 dialog 內,使用者按完 dialog 才真正消耗配額。
 */
function openAnalysisDialog(): void {
  analysisDialogVisible.value = true
}

/** 配額用完時 disabled + tooltip(B2 設計)— 但 dialog 也擋一次,雙保險 */
const analyzeDisabled = computed(() =>
    analysisStore.quota.used >= analysisStore.quota.limit
)
const quotaTooltip = computed(() =>
    analysisStore.quota.used >= analysisStore.quota.limit
        ? t('workAnalysis.quotaTooltip', {limit: analysisStore.quota.limit})
        : '',
)

</script>

<template>
  <div :class="['work-collect-view', { 'work-collect-view--embedded': props.embedded }]">
    <!-- ── 頂部 ──────────────────────────────────────────── -->
    <div class="header">
      <!-- 返回按鈕:embedded 模式(LogViewer 等無 router 場景)隱藏 -->
      <el-button
          v-if="!props.embedded"
          :icon="ArrowLeft"
          class="back-btn"
          plain
          size="small"
          @click="goBack"
      >
        {{ t('workCollect.back') }}
      </el-button>
      <h2 v-if="!props.embedded" class="title">
        <el-icon><VideoCamera /></el-icon>
        {{ t('workCollect.title') }}
      </h2>
      <div class="header__spacer" />

      <!-- 配額提示 — 點分析按鈕前讓使用者知道用了幾次 -->
      <span class="header__quota">
        {{ t('workAnalysis.quotaLabel', {used: analysisStore.quota.used, limit: analysisStore.quota.limit}) }}
      </span>

      <!-- 分析按鈕:配額用完 disabled + tooltip(對應 B2)。
           點下去開 dialog,真正觸發分析在 dialog 內 -->
      <el-tooltip
          :content="quotaTooltip"
          :disabled="!quotaTooltip"
          placement="top"
      >
        <el-button
            :disabled="analyzeDisabled"
            :icon="MagicStick"
            size="small"
            type="primary"
            @click="openAnalysisDialog"
        >
          {{ t('workAnalysis.analyzeButton') }}
        </el-button>
      </el-tooltip>

      <el-radio-group v-model="viewMode" size="small">
        <el-radio-button value="day">{{ t('workCollect.viewDay') }}</el-radio-button>
        <el-radio-button value="week">{{ t('workCollect.viewWeek') }}</el-radio-button>
      </el-radio-group>
    </div>

    <!-- 分析報告卡(有報告才顯示) -->
    <AnalysisCard/>

    <!-- 分析 Dialog(三階段:配置 → 流式 → 報告)。掛在 view 內,點按鈕才開 -->
    <AnalysisDialog v-model="analysisDialogVisible"/>


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
          <!-- eslint-disable-next-line vue/no-v-html -- 內容來自應用內 i18n 字典(我方控制) + 受控的 workHoursLabel 字串,無外部輸入 -->
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
              :records="weeklyHeatmapRecords"
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
              :records="weeklyHeatmapRecords"
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
  /* 用 container query 取代 viewport media — 嵌在 log-viewer 裡時,可用寬度比 viewport 小了 160px sidebar,
     viewport-based breakpoint 會在還很寬的視窗下就誤判單欄,donut 卡被拉成全寬空盪 */
  container-type: inline-size;

  /* ────────────────────────────────────────────────────────
   * 圖表高度三階變數 — 子件(donut / bar / heatmap / line)直接 var() 取用。
   *
   * 設計:`clamp(下界, 視窗百分比, 上界)`
   *   - 下界 rem  → 13~14 吋筆電(視窗高度可能只 600px)不會被壓到看不見
   *   - 中段 vh   → 大多數視窗下隨高度等比例縮放,真正的「響應式」
   *   - 上界 rem  → 4K 螢幕(2160px 高)不會把單一圖表撐到 800px 把整頁吃掉
   *
   * 為什麼用 rem 不用 px:rem 跟著根字級走,使用者調系統字級時整套圖表跟著縮放,
   * 比寫死 px 更貼近「響應式」的精神。CSS 變數又集中在這裡,要調幅度只動一處。
   *
   * 三階對應:
   *   --chart-h-sm:小圖(類別佔比 donut、應用排名 bar)
   *   --chart-h-md:中圖(每小時柱狀、週堆疊、熱力圖)
   *   --chart-h-lg:大圖(每日趨勢線 — 需要垂直空間看出形狀)
   */
  --chart-h-sm: clamp(13rem, 26vh, 20rem);
  --chart-h-md: clamp(15rem, 32vh, 24rem);
  --chart-h-lg: clamp(18rem, 42vh, 30rem);
}

/* embedded(嵌在 log-viewer)時,padding 收小、不再 center;沒有外層標題,占用空間少 */
.work-collect-view--embedded {
  padding: 16px 20px;
  max-width: none;
}

.header {
  display: flex;
  align-items: center;
  gap: 16px;
}

/* embedded 沒有 H2 標題,header 只剩右側切換鈕 — 把它推到右側即可,
   不再用 spacer 在中間留一大塊空白 */
.work-collect-view--embedded .header {
  justify-content: flex-end;
}

.header__spacer {
  flex: 1;
}

.header__quota {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.back-btn {
  flex-shrink: 0;
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

/* 用 container query — 依 .work-collect-view 自身寬度判斷,而非 viewport。
   嵌在 log-viewer (有 sidebar) 還是獨立主窗,都能正確響應自己的可用寬度。
   880 是 donut 卡 (1fr) 縮到約 290px 還能放下基本標籤的下限 */
@container (max-width: 880px) {
  .charts-row {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
