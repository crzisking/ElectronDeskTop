<script lang="ts" setup>
/**
 * AnalysisCard — 顯示「最新一份分析報告」+「歷史摺疊」面板。
 *
 * v2 改造後職責縮小:**不負責觸發分析**(那部分搬到 AnalysisDialog)。
 * 本檔只渲染已落庫的報告,並提供:
 *   - 切換到歷史報告(view-only,不影響 DB)
 *   - 一鍵清除全部報告(逃生口,跟設置頁同入口都觸發 store.clearAllReports)
 *
 * 報告分四段(對應 main AnalysisReportPayload):
 *   summary / timeAllocation / highlights / opportunities / tomorrowSuggestion
 *
 * reportJson 解析失敗(unstructured 路徑)→ raw text + warning。
 */

import {computed, ref} from 'vue'
import {useI18n} from 'vue-i18n'
import {ElMessage, ElMessageBox} from 'element-plus'
import {ArrowDown, ArrowUp, Document} from '@element-plus/icons-vue'
import {useWorkAnalysisStore} from './store'
import ReportContent from './ReportContent.vue'
import type {AnalysisReport, AnalysisReportRow} from '@/types/electron/work-analysis'

const {t, locale} = useI18n()
const store = useWorkAnalysisStore()

/** 歷史摺疊面板開關 */
const historyOpen = ref(false)
/** 報告本體折疊 — 預設收起,頁面不被長報告擠爆;點 header 整列切換 */
const bodyOpen = ref(false)

/**
 * 嘗試把 reportJson parse 成 AnalysisReport。
 * 走 unstructured 路徑時(parse 失敗 / 結構不符),回 null,UI 顯示 raw。
 */
const parsedReport = computed<AnalysisReport | null>(() => {
  if (!store.latest) return null
  try {
    const parsed = JSON.parse(store.latest.reportJson)
    // 簡單檢查必填欄位(對齊 main 端 schema)
    if (parsed && typeof parsed.summary === 'string') return parsed as AnalysisReport
    return null
  } catch {
    return null
  }
})

const isUnstructured = computed(() => store.latest !== null && parsedReport.value === null)

function formatTimeRange(row: AnalysisReportRow): string {
  const from = new Date(row.rangeStart)
  const to = new Date(row.rangeEnd)
  return `${formatDateTime(from)} ~ ${formatDateTime(to)}`
}

function formatDateTime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function formatHistoryItem(item: { rangeStart: number; rangeEnd: number; recordCount: number; providerLabel: string }) {
  const d = new Date(item.rangeStart)
  const pad = (n: number) => String(n).padStart(2, '0')
  const dateStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  // 「今日 / 昨日」標籤
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const yesterday = today.getTime() - 86_400_000
  const dayStart = new Date(d)
  dayStart.setHours(0, 0, 0, 0)
  let dayLabel = ''
  if (dayStart.getTime() === today.getTime()) {
    dayLabel = `(${t('workAnalysis.today')})`
  } else if (dayStart.getTime() === yesterday) {
    dayLabel = `(${t('workAnalysis.yesterday')})`
  }
  return `${dateStr} ${dayLabel} · ${t('workAnalysis.recordsCount', {count: item.recordCount})} · ${item.providerLabel}`
}

async function handleSelect(id: string) {
  await store.selectReport(id)
}

async function handleDeleteAll() {
  try {
    await ElMessageBox.confirm(
        t('workAnalysis.confirmClearAll'),
        t('common.confirm'),
        {type: 'warning', confirmButtonText: t('common.delete'), cancelButtonText: t('common.cancel')},
    )
  } catch {
    return
  }
  const result = await store.clearAllReports()
  if (result.ok) {
    ElMessage.success(t('workAnalysis.clearedAll', {count: result.deleted}))
    historyOpen.value = false
  } else {
    ElMessage.error(t('workAnalysis.clearFailed'))
  }
}

// locale 響應式依賴 — 切語言時報告 verdict 等翻譯跟著更新
void locale
</script>

<template>
  <el-card v-if="store.latest" class="analysis-card" shadow="never">
    <!-- ── 頂部:時段 / provider / 配額;整列可點 = 折疊/展開報告本體 ── -->
    <div class="analysis-card__header analysis-card__header--toggle" @click="bodyOpen = !bodyOpen">
      <div class="analysis-card__title">
        <el-icon>
          <Document/>
        </el-icon>
        <span>{{ t('workAnalysis.reportTitle') }}</span>
        <el-icon class="fold-icon">
          <component :is="bodyOpen ? ArrowUp : ArrowDown"/>
        </el-icon>
      </div>
      <div class="analysis-card__meta">
        <span class="meta-chip">
          {{ formatTimeRange(store.latest) }}
        </span>
        <span class="meta-chip meta-chip--provider">
          {{ store.latest.providerLabel }} · {{ store.latest.modelUsed }}
        </span>
        <span class="meta-chip">
          {{ t('workAnalysis.recordsCount', {count: store.latest.recordCount}) }}
        </span>
      </div>
    </div>

    <!-- ── unstructured fallback:JSON 解析失敗,顯示 raw text ── -->
    <el-alert
        v-if="isUnstructured && bodyOpen"
        :closable="false"
        :title="t('workAnalysis.unstructuredWarning')"
        class="analysis-card__warning"
        show-icon
        type="warning"
    />
    <pre v-if="isUnstructured && bodyOpen" class="analysis-card__raw">{{ store.latest.reportJson }}</pre>

    <!-- ── 正常結構化渲染 — 走共用 ReportContent(內含 reasoning / leverage 新區塊) ── -->
    <ReportContent v-else-if="parsedReport && bodyOpen" :report="parsedReport"/>

    <!-- ── 歷史摺疊 ───────────────────────────────────────────── -->
    <div v-if="bodyOpen && store.history.length > 1" class="analysis-card__footer">
      <el-button
          :icon="historyOpen ? ArrowUp : ArrowDown"
          link
          @click="historyOpen = !historyOpen"
      >
        {{ historyOpen ? t('workAnalysis.hideHistory') : t('workAnalysis.showHistory') }}
        ({{ store.history.length }})
      </el-button>
      <div v-if="historyOpen" class="history-list">
        <button
            v-for="item in store.history"
            :key="item.id"
            :class="{ 'is-active': item.id === store.latest?.id }"
            class="history-item"
            type="button"
            @click="handleSelect(item.id)"
        >
          {{ formatHistoryItem(item) }}
        </button>
        <el-button
            class="history-clear-btn"
            link
            size="small"
            type="danger"
            @click="handleDeleteAll"
        >
          {{ t('workAnalysis.clearAll') }}
        </el-button>
      </div>
    </div>
  </el-card>
</template>

<style scoped>
.analysis-card {
  border-radius: 12px;
}

.analysis-card__header--toggle {
  cursor: pointer;
  user-select: none;
}

.fold-icon {
  color: var(--el-text-color-secondary);
  margin-left: 4px;
}

.analysis-card__header {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 14px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.analysis-card__title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 16px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.analysis-card__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.meta-chip {
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 12px;
  background: var(--el-fill-color-light);
  color: var(--el-text-color-secondary);
}

.meta-chip--provider {
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
}

.analysis-card__warning {
  margin-bottom: 12px;
}

.analysis-card__raw {
  max-height: 360px;
  overflow: auto;
  background: var(--el-fill-color-light);
  padding: 10px 12px;
  border-radius: 8px;
  font-size: 12px;
  font-family: var(--el-font-family-mono, ui-monospace, 'SF Mono', Menlo, monospace);
  white-space: pre-wrap;
  word-break: break-all;
}

.report-section {
  margin-bottom: 16px;
}

.report-section--tomorrow {
  background: var(--el-color-primary-light-9);
  padding: 12px 14px;
  border-radius: 8px;
  border-left: 3px solid var(--el-color-primary);
}

.report-section__title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  font-weight: 600;
  margin: 0 0 8px;
  color: var(--el-text-color-primary);
}

.report-section__summary {
  margin: 0;
  font-size: 14px;
  line-height: 1.7;
  color: var(--el-text-color-regular);
}

.report-section__text {
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
  color: var(--el-text-color-regular);
}

.report-section__icon--good {
  color: var(--el-color-success);
}

.report-section__icon--opp {
  color: var(--el-color-warning);
}

.report-section__list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.report-item {
  padding: 10px 12px;
  background: var(--el-fill-color-light);
  border-radius: 8px;
}

.report-item__title {
  font-size: 13px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  margin-bottom: 4px;
}

.report-item__detail {
  font-size: 12px;
  line-height: 1.6;
  color: var(--el-text-color-regular);
}

.report-item__detail strong {
  color: var(--el-text-color-primary);
  margin-right: 4px;
}

.analysis-card__footer {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--el-border-color-lighter);
}

.history-list {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.history-item {
  padding: 6px 10px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  background: transparent;
  text-align: left;
  font-size: 12px;
  color: var(--el-text-color-regular);
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}

.history-item:hover {
  background: var(--el-fill-color-light);
}

.history-item.is-active {
  border-color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
}

.history-clear-btn {
  align-self: flex-end;
  margin-top: 4px;
}
</style>
