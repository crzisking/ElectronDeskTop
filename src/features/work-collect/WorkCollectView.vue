<script setup lang="ts">
/**
 * 工作自動採集 — 主視圖(v2,圖表化版)。
 *
 * 佈局:
 *   1. 頂部:返回 + 標題
 *   2. 設定卡:採集開關 + 規則說明
 *   3. 統計卡片群(StatCards):今日筆數 / 覆蓋小時 / 主要類別 / 上次採集
 *   4. 主圖區:每小時堆疊柱狀(HourlyStackedChart)+ 類別佔比(CategoryDonut)
 *   5. 詳細列表(TimelineList):原時間軸,放最後
 *
 * 採集 tick 訂閱在 App.vue 已 bootstrap,本頁進來只負責 refresh 載入紀錄。
 */

import {onMounted, computed} from 'vue'
import {useRouter} from 'vue-router'
import {ArrowLeft, Monitor, VideoCamera} from '@element-plus/icons-vue'
import {ElMessage} from 'element-plus'
import {useWorkCollectStore} from './store'
import StatCards from './components/StatCards.vue'
import HourlyStackedChart from './components/HourlyStackedChart.vue'
import CategoryDonut from './components/CategoryDonut.vue'
import TimelineList from './components/TimelineList.vue'

const router = useRouter()
const store = useWorkCollectStore()

function handleBack() {
  if (window.history.length > 1) router.back()
  else router.push({name: 'personal-functions'})
}

async function onToggleChange(next: boolean) {
  try {
    await store.toggle(next)
    ElMessage.success(next ? '已啟用工作採集' : '已停用工作採集')
  } catch {
    ElMessage.error('切換失敗,請查看日誌')
  }
}

/** UI 標題用,顯示「採集時段 08:00-17:00」 */
const workHoursLabel = computed(() => {
  const {start, end} = store.workHours
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(start)}:00 - ${pad(end)}:00`
})

onMounted(async () => {
  await store.refresh()
})
</script>

<template>
  <div class="work-collect-view">
    <!-- ── 頂部 ──────────────────────────────────────────── -->
    <div class="header">
      <el-button text :icon="ArrowLeft" @click="handleBack">返回</el-button>
      <h2 class="title">
        <el-icon><VideoCamera/></el-icon>
        工作自動採集
      </h2>
    </div>

    <!-- ── 設定卡 ──────────────────────────────────────────── -->
    <el-card class="settings-card" shadow="never">
      <div class="setting-row">
        <div class="setting-info">
          <div class="label">啟用採集</div>
          <div class="hint">
            開啟後,每
            <strong>{{ store.intervalMinutes }} 分鐘</strong>
            自動擷取一次螢幕內容並送 AI 分析,結果只存在本機 SQLite,**截圖不落地**。
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
          <el-icon><Monitor/></el-icon>
          採集時段:<strong>{{ workHoursLabel }}</strong>(此區間外不採集)
        </div>
        <div class="rule">
          <el-icon><Monitor/></el-icon>
          螢幕鎖定時自動暫停,解鎖後恢復
        </div>
      </div>
    </el-card>

    <!-- ── 統計卡片 ─────────────────────────────────────── -->
    <StatCards :records="store.records"/>

    <!-- ── 主圖區:柱狀 + Donut ─────────────────────────── -->
    <div class="charts-row">
      <div class="charts-row__hourly">
        <HourlyStackedChart
          :records="store.records"
          :start-hour="store.workHours.start"
          :end-hour="store.workHours.end"
        />
      </div>
      <div class="charts-row__donut">
        <CategoryDonut :records="store.records"/>
      </div>
    </div>

    <!-- ── 詳細時間軸 ──────────────────────────────────── -->
    <TimelineList :records="store.records" :loading="store.loading"/>
  </div>
</template>

<style scoped>
.work-collect-view {
  padding: 24px;
  max-width: 1120px;
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
.charts-row {
  display: grid;
  grid-template-columns: 2fr 1fr;
  gap: 16px;
}

@media (max-width: 880px) {
  .charts-row {
    grid-template-columns: 1fr;
  }
}
</style>
