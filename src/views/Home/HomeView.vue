<!--
  首頁 — 登入後的個人儀表板(雜誌式雙欄,flat editorial 風格:白底、細分隔線、大字排版)。

  左欄(固定窄欄):日期 → 大字問候+姓名 → 副標 → 縱向統計(今日時長 / 最投入類別 / 活躍時段)
  右欄:今日工作熱力(24h)→ 類別分佈 → 今日學習建議(編號條目 + 關鍵字 chips)

  數據全部本地:熱力/分佈來自 todayActivity IPC,建議來自 dailyAdvice IPC(每天 08:00 生成)。
-->
<template>
  <div class="home-view">
    <!-- ── 左欄:問候 + 統計 ───────────────────────────── -->
    <aside class="left">
      <div class="date">{{ todayText }}</div>
      <h1 class="greet">{{ greeting }}<br>{{ displayName }}</h1>
      <p class="greet-sub">{{ $t('home.heroSub') }}</p>

      <el-divider/>

      <div class="stat">
        <div class="stat-label">
          <el-icon>
            <Clock/>
          </el-icon>
          {{ $t('home.statPace') }}
        </div>
        <div class="stat-value">{{ paceText }}</div>
      </div>
      <el-divider/>
      <div class="stat">
        <div class="stat-label">
          <el-icon>
            <DataLine/>
          </el-icon>
          {{ $t('home.statTopCategory') }}
        </div>
        <div class="stat-value accent">{{ topCategory }}</div>
      </div>
      <el-divider/>
      <div class="stat">
        <div class="stat-label">
          <el-icon>
            <Timer/>
          </el-icon>
          {{ $t('home.statActiveHours') }}
        </div>
        <div class="stat-value">{{ activeHours }}</div>
      </div>
    </aside>

    <!-- ── 右欄:熱力 / 分佈 / 建議 ────────────────────── -->
    <main class="right">
      <!-- 今日工作熱力 -->
      <section class="sec">
        <div class="sec-label">{{ $t('home.heatTitle') }}</div>
        <div class="heat-row">
          <el-tooltip
              v-for="(m, h) in activity.hourly"
              :key="h"
              :content="`${pad(h)}:00 — ${m} ${$t('home.minutesUnit')}`"
              placement="top"
          >
            <div :style="heatStyle(m)" class="heat-cell"/>
          </el-tooltip>
        </div>
        <div class="heat-axis">
          <span>0</span><span>6</span><span>12</span><span>18</span><span>23</span>
        </div>
      </section>

      <el-divider/>

      <!-- 類別分佈 -->
      <section class="sec">
        <div class="sec-label">{{ $t('home.distTitle') }}</div>
        <template v-if="activity.categories.length">
          <div class="dist-bar">
            <el-tooltip
                v-for="(c, i) in activity.categories"
                :key="c.category"
                :content="`${c.category} · ${distPercent(c.minutes)}`"
                placement="top"
            >
              <div :style="{width: distWidth(c.minutes), background: distColor(i)}" class="dist-seg"/>
            </el-tooltip>
          </div>
          <div class="dist-legend">
                        <span v-for="(c, i) in activity.categories.slice(0, 6)" :key="c.category" class="legend-item">
                            <i :style="{background: distColor(i)}" class="dot"/>
                            <b>{{ c.category }}</b>&nbsp;{{ distPercent(c.minutes) }}
                        </span>
          </div>
        </template>
        <div v-else class="sec-empty">{{ $t('home.noActivityYet') }}</div>
      </section>

      <el-divider/>

      <!-- 待辦備忘:按到期排序,逾期紅 / 24h 內橙;點任意處開備忘獨立窗 -->
      <section class="sec">
        <div class="sec-head">
          <span class="sec-label">{{ $t('home.memosTitle') }}</span>
          <el-button link size="small" type="primary" @click="openMemosWindow">
            {{ $t('home.memosOpen') }} ↗
          </el-button>
        </div>
        <div v-if="!memos.length" class="sec-empty">{{ $t('home.memosEmpty') }}</div>
        <ul v-else class="memo-list">
          <li v-for="m in memos" :key="m.memoId" class="memo-item" @click="openMemosWindow">
            <i :class="dueClass(m.dueDate)" class="memo-dot"/>
            <span class="memo-title">{{ m.title }}</span>
            <span :class="dueClass(m.dueDate)" class="memo-due">{{ dueText(m.dueDate) }}</span>
          </li>
        </ul>
      </section>

      <el-divider/>

      <!-- 今日學習建議 -->
      <section v-loading="loading" class="sec">
        <div class="sec-head">
          <span class="sec-label">{{ $t('home.adviceTitle') }}</span>
          <span class="sec-side">
                        <span v-if="status?.today" class="gen-time">
                            {{ $t('home.generatedAt', {time: formatTime(status.today.createdAt)}) }}
                        </span>
                        <el-button v-if="ready" :loading="generating" size="small" @click="onGenerate">
                            {{ status?.today ? $t('home.regenerate') : $t('home.generateNow') }}
                        </el-button>
                    </span>
        </div>

        <!-- 前置未滿足:逐項引導 -->
        <div v-if="status && !ready" class="setup-guide">
          <p>{{ $t('home.setupIntro') }}</p>
          <div :class="{done: status.templateBound}" class="guide-item">
            <span>{{ status.templateBound ? '✅' : '⬜' }}</span>
            <span>{{ $t('home.needTemplate') }}</span>
            <el-button v-if="!status.templateBound" link type="primary" @click="$router.push({name: 'work-collect'})">
              {{ $t('home.goBind') }}
            </el-button>
            <el-tag v-else size="small" type="success">{{ status.templateName }}</el-tag>
          </div>
          <div :class="{done: status.llmConfigured}" class="guide-item">
            <span>{{ status.llmConfigured ? '✅' : '⬜' }}</span>
            <span>{{ $t('home.needLlm') }}</span>
            <el-button v-if="!status.llmConfigured" link type="primary" @click="ui.openSettings('llm')">
              {{ $t('home.goConfig') }}
            </el-button>
          </div>
        </div>

        <!-- 今日建議:編號條目 + 關鍵字 chips -->
        <template v-else-if="content">
          <p class="summary">{{ content.summary }}</p>
          <div v-for="(s, i) in content.suggestions" :key="i" class="sug">
            <div class="sug-head">
              <span class="sug-no">{{ pad(i + 1) }}</span>
              <span class="sug-title">{{ s.title }}</span>
            </div>
            <p class="sug-detail">{{ s.detail }}</p>
            <div v-if="s.keywords?.length" class="sug-chips">
              <span v-for="k in s.keywords" :key="k" class="chip">{{ k }}</span>
            </div>
          </div>
          <p v-if="status?.today" class="foot-meta">
            {{ $t('home.basedOn', {n: status.today.recordCount, job: status.today.templateName ?? '-'}) }}
          </p>
        </template>

        <el-empty v-else-if="!loading" :description="$t('home.noAdviceYet')" :image-size="64"/>
      </section>
    </main>
  </div>
</template>

<script lang="ts" setup>
import {computed, onMounted, onUnmounted, ref} from 'vue'
import {ElMessage} from 'element-plus'
import {Clock, DataLine, Timer} from '@element-plus/icons-vue'
import {IpcChannels} from '@shared/ipc-channels'
import {useUiStore} from '@/stores/ui.store'
import {useAuthStore} from '@/stores/auth.store'
import {useI18n} from 'vue-i18n'
import {formatClock as formatTime} from '@/shared/utils/format'
import {projectFlowApi} from '@/features/project-flow/api'
import type {MemoResponse, TodayActivitySummary} from '@/features/project-flow/types'
import type {DailyAdviceContent, DailyAdviceRow, DailyAdviceStatus} from '@/types/electron/daily-advice'

const ui = useUiStore()
const auth = useAuthStore()
const {t} = useI18n()

// ─── 左欄:問候 ──────────────────────────────────────────────

const displayName = computed(() => auth.user?.name || auth.user?.userName || '')

const hour = new Date().getHours()
/** 5-11 早安 / 11-14 午安 / 14-18 下午好 / 其餘 晚安 */
const greeting = computed(() => {
  if (hour >= 5 && hour < 11) return t('home.greetMorning')
  if (hour >= 11 && hour < 14) return t('home.greetNoon')
  if (hour >= 14 && hour < 18) return t('home.greetAfternoon')
  return t('home.greetEvening')
})

const todayText = new Date().toLocaleDateString(undefined, {month: 'long', day: 'numeric', weekday: 'long'})

// ─── 今日活動(熱力 + 分佈 + 統計) ──────────────────────────

const activity = ref<TodayActivitySummary>({categories: [], hourly: new Array(24).fill(0)})

const totalMinutes = computed(() => activity.value.categories.reduce((s, c) => s + c.minutes, 0))

/** 不直接亮時長數字 — 換成質性「節奏」描述,氛圍感 > 監控感 */
const paceText = computed(() => {
  const m = totalMinutes.value
  if (m <= 0) return t('home.pace0')
  if (m < 60) return t('home.pace1')
  if (m < 240) return t('home.pace2')
  return t('home.pace3')
})

/** 分佈圖例 / tooltip 用佔比,不露原始分鐘 */
const distPercent = (minutes: number) =>
    `${Math.round((minutes / Math.max(1, totalMinutes.value)) * 100)}%`
const topCategory = computed(() => activity.value.categories[0]?.category ?? '—')
const activeHours = computed(() => activity.value.hourly.filter((m) => m > 0).length)

const pad = (n: number) => String(n).padStart(2, '0')

/** 熱力格:強度 → 藍色深淺(0 給淡灰) */
function heatStyle(minutes: number) {
  if (minutes <= 0) return {background: '#eef1f6'}
  const alpha = 0.25 + (minutes / 60) * 0.75
  return {background: `rgba(48, 90, 158, ${alpha.toFixed(2)})`}
}

const DIST_COLORS = ['#3a5d96', '#5b8bc9', '#74a8e0', '#9cc2ec', '#c4d9f4', '#8492a6', '#b37feb', '#36cfc9']
const distColor = (i: number) => DIST_COLORS[i % DIST_COLORS.length]
const distWidth = (minutes: number) => `${Math.max(2, (minutes / Math.max(1, totalMinutes.value)) * 100)}%`

async function loadActivity() {
  try {
    activity.value = await projectFlowApi.todayActivity()
  } catch {
    /* 採集服務沒起來就顯示空熱力,不打擾 */
  }
}

// ─── 待辦備忘(到期近的在前;主進程另有 30 分鐘級系統通知) ──

const MEMO_SHOW_LIMIT = 4
const DAY = 86_400_000

const memos = ref<MemoResponse[]>([])

async function loadMemos() {
  try {
    const r = await projectFlowApi.listMemos({status: 'pending', pageIndex: 1, pageSize: 50})
    memos.value = (r?.list ?? [])
        .sort((a, b) => (a.dueDate ?? Number.MAX_SAFE_INTEGER) - (b.dueDate ?? Number.MAX_SAFE_INTEGER))
        .slice(0, MEMO_SHOW_LIMIT)
  } catch {
    /* 未登入 / 後端不可達 → 顯示空狀態,不打擾 */
  }
}

/** 到期文案:逾期 N 天 / 今天到期 / N 天後 / 無期限 */
function dueText(due?: number | null): string {
  if (!due) return t('home.memoNoDue')
  const diff = Math.ceil((due - Date.now()) / DAY)
  if (diff < 0) return t('home.memoOverdue', {n: -diff})
  if (diff === 0) return t('home.memoDueToday')
  return t('home.memoDueDays', {n: diff})
}

/** 顏色等級:逾期紅 / 24h 內橙 / 其餘灰 */
function dueClass(due?: number | null): string {
  if (!due) return 'lv-none'
  const diff = due - Date.now()
  if (diff < 0) return 'lv-overdue'
  if (diff <= DAY) return 'lv-soon'
  return 'lv-normal'
}

function openMemosWindow() {
  window.electronAPI.window.openMemos().catch(() => {
    /* 視窗開啟失敗不擴散 */
  })
}

// ─── 學習建議 ────────────────────────────────────────────────

const loading = ref(false)
const generating = ref(false)
const status = ref<DailyAdviceStatus | null>(null)

const ready = computed(() => !!status.value?.templateBound && !!status.value?.llmConfigured)

const content = computed<DailyAdviceContent | null>(() => {
  const json = status.value?.today?.contentJson
  if (!json) return null
  try {
    return JSON.parse(json) as DailyAdviceContent
  } catch {
    return null
  }
})

onMounted(() => {
  void load()
  void loadActivity()
  void loadMemos()
  window.electronAPI.on(IpcChannels.PUSH_DAILY_ADVICE, onPush)
})
onUnmounted(() => {
  window.electronAPI.off(IpcChannels.PUSH_DAILY_ADVICE, onPush)
})

function onPush(...args: unknown[]) {
  const row = args[0] as DailyAdviceRow
  if (status.value) status.value.today = row
}

async function load() {
  loading.value = true
  try {
    const r = await window.electronAPI.dailyAdvice.status()
    if (r.ok) status.value = r.data
    else ElMessage.error(r.error)
  } finally {
    loading.value = false
  }
}

async function onGenerate() {
  generating.value = true
  try {
    const r = await window.electronAPI.dailyAdvice.generate()
    if (r.ok) {
      if (status.value) status.value.today = r.data
    } else {
      ElMessage.error(r.error)
    }
  } finally {
    generating.value = false
  }
}
</script>

<style scoped>
/* ── 雜誌式雙欄:flat、白底、細分隔線、大字排版 ──
   固定一屏不出滾動條:整頁 height:100% + overflow hidden,
   右欄內部可滾但滾動條隱藏(滾輪可滑,視覺乾淨) */
.home-view {
  display: grid;
  grid-template-columns: 240px minmax(0, 1fr);
  gap: 40px;
  padding: 28px 40px;
  max-width: 1080px;
  height: 100%;
  box-sizing: border-box;
  overflow: hidden;
}

.left {
  overflow: hidden;
}

.right {
  min-width: 0;
  overflow-y: auto;
  /* 隱藏滾動條但保留滾動能力 */
  scrollbar-width: none; /* Firefox */
}

.right::-webkit-scrollbar {
  display: none; /* Chromium */
}

/* ── 左欄 ── */
.date {
  font-size: 13px;
  color: #8a94a6;
  letter-spacing: 2px;
  margin-bottom: 14px;
}

.greet {
  margin: 0;
  font-size: 30px;
  line-height: 1.3;
  font-weight: 800;
  color: #1f2d3d;
  letter-spacing: 1px;
}

.greet-sub {
  margin: 10px 0 0;
  font-size: 13px;
  color: #8a94a6;
}

.stat {
  padding: 2px 0;
}

.stat-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #8a94a6;
  margin-bottom: 8px;
  letter-spacing: 1px;
}

.stat-value {
  font-size: 24px;
  font-weight: 800;
  color: #1f2d3d;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.stat-value .unit {
  font-size: 13px;
  font-weight: 500;
  color: #8a94a6;
  margin-left: 2px;
}

.stat-value.accent {
  color: #305a9e;
}

/* ── 右欄 sections ── */
.sec-label {
  font-size: 13px;
  color: #8a94a6;
  letter-spacing: 2px;
  margin-bottom: 12px;
}

.sec-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
}

.sec-head .sec-label {
  margin-bottom: 0;
}

.sec-side {
  display: flex;
  align-items: center;
  gap: 12px;
}

.gen-time {
  font-size: 12px;
  color: #8a94a6;
}

.sec-empty {
  font-size: 13px;
  color: #c0c4cc;
}

/* 熱力 */
.heat-row {
  display: grid;
  grid-template-columns: repeat(24, 1fr);
  gap: 5px;
}

.heat-cell {
  height: 24px;
  border-radius: 4px;
  transition: transform 0.1s;
  cursor: default;
}

.heat-cell:hover {
  transform: scale(1.18);
}

.heat-axis {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: #c0c4cc;
  margin-top: 8px;
  padding: 0 2px;
}

/* 分佈 */
.dist-bar {
  display: flex;
  height: 10px;
  border-radius: 5px;
  overflow: hidden;
  gap: 2px;
}

.dist-seg {
  height: 100%;
  min-width: 4px;
  cursor: default;
}

.dist-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  margin-top: 12px;
  font-size: 12px;
  color: #5e6d82;
}

.legend-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.legend-item b {
  color: #1f2d3d;
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: inline-block;
}

/* 待辦備忘 */
.memo-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.memo-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
  border-bottom: 1px dashed #f0f2f5;
  cursor: pointer;
}

.memo-item:last-child {
  border-bottom: none;
}

.memo-item:hover .memo-title {
  color: #305a9e;
}

.memo-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex: none;
}

.memo-title {
  font-size: 13px;
  color: #3c4858;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.memo-due {
  font-size: 12px;
  flex: none;
}

/* 到期等級配色:dot 背景 + due 文字共用 */
.memo-dot.lv-overdue {
  background: #f56c6c;
}

.memo-dot.lv-soon {
  background: #e6a23c;
}

.memo-dot.lv-normal {
  background: #a3b0c2;
}

.memo-dot.lv-none {
  background: #dcdfe6;
}

.memo-due.lv-overdue {
  color: #f56c6c;
  font-weight: 600;
}

.memo-due.lv-soon {
  color: #e6a23c;
}

.memo-due.lv-normal, .memo-due.lv-none {
  color: #8a94a6;
}

/* 建議 */
.summary {
  color: #3c4858;
  font-size: 13px;
  line-height: 1.7;
  margin: 0 0 14px;
}

.sug {
  margin-bottom: 14px;
}

.sug-head {
  display: flex;
  align-items: baseline;
  gap: 12px;
}

.sug-no {
  font-size: 13px;
  font-weight: 700;
  color: #a3b0c2;
  font-variant-numeric: tabular-nums;
}

.sug-title {
  font-size: 15px;
  font-weight: 700;
  color: #1f2d3d;
}

.sug-detail {
  margin: 4px 0 0 29px;
  font-size: 13px;
  color: #5e6d82;
  line-height: 1.7;
}

.sug-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 8px 0 0 29px;
}

.chip {
  font-size: 12px;
  color: #305a9e;
  background: #eef4fd;
  border: 1px solid #d4e3f7;
  border-radius: 5px;
  padding: 2px 10px;
  font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
}

.foot-meta {
  font-size: 12px;
  color: #c0c4cc;
  margin: 4px 0 0;
}

/* 引導 */
.setup-guide p {
  color: #5e6d82;
  font-size: 13px;
}

.guide-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 0;
  font-size: 13px;
}

.guide-item.done {
  color: #67c23a;
}

/* 窄窗:左欄疊到上面 */
@media (max-width: 760px) {
  .home-view {
    grid-template-columns: 1fr;
    gap: 24px;
    padding: 24px;
  }
}

/* el-divider 預設 24px 上下太肥,收緊讓一屏放得下 */
.home-view :deep(.el-divider--horizontal) {
  margin: 16px 0;
}
</style>
