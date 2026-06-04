<script lang="ts" setup>
/**
 * ReportContent — 渲染結構化分析報告的共用元件。
 *
 * 為何抽出來:
 *   AnalysisDialog 階段 3 跟 AnalysisCard 都顯示同樣的報告結構,以前各寫一份模板。
 *   新增 reasoning / leverage 區塊後重複代碼會放大,集中到一個元件管理。
 *
 * Props:
 *   report  AnalysisReport(必填,parsed 過的結構化報告)
 *
 * 不負責:
 *   - 拿資料(由父層注入 props)
 *   - 處理 raw text fallback(那是父層判斷 isStructured 後決定渲不渲)
 *   - footer 按鈕(屬於 Dialog / Card 的 layout)
 */

import {computed} from 'vue'
import {useI18n} from 'vue-i18n'
import {InfoFilled, QuestionFilled} from '@element-plus/icons-vue'
import type {AnalysisReport, Confidence, LeverageLevel} from '@/types/electron/work-analysis'

const props = defineProps<{
  report: AnalysisReport
}>()

const {t} = useI18n()

const verdictKey = computed(() => `workAnalysis.verdict.${props.report.timeAllocation.verdict}`)

/** verdict 對應 el-tag type;unclear 用 info 灰色。default 兜底是 lint 要求 — 實際上 union 已窮盡 */
const verdictTagType = computed(() => {
  switch (props.report.timeAllocation.verdict) {
    case 'balanced':
      return 'success'
    case 'skewed-high':
    case 'skewed-low':
      return 'warning'
    case 'unclear':
    default:
      return 'info'
  }
})

/** confidence 標籤色 */
function confidenceClass(c: Confidence): string {
  return `confidence-tag confidence-tag--${c}`
}

/** L1-L5 顯示:加底色,跨層級從淺到深 */
function leverageClass(level: LeverageLevel): string {
  return `leverage-pill leverage-pill--${level.toLowerCase()}`
}

const hasReasoning = computed(() => props.report.reasoning.length > 0)
</script>

<template>
  <div class="report-content">
    <!-- ── Summary ─────────────────────────────────────────── -->
    <section class="report-section">
      <p class="report-section__summary">{{ report.summary }}</p>
    </section>

    <!-- ── 判斷依據(新增,核心) ───────────────────────────── -->
    <section v-if="hasReasoning" class="report-section">
      <h3 class="report-section__title">
        <el-icon class="report-section__icon">
          <InfoFilled/>
        </el-icon>
        {{ t('workAnalysis.reasoning') }}
        <span class="report-section__hint">{{ t('workAnalysis.reasoningHint') }}</span>
      </h3>
      <ul class="reasoning-list">
        <li
            v-for="(item, idx) in report.reasoning"
            :key="idx"
            class="reasoning-item"
        >
          <div class="reasoning-item__header">
            <span class="reasoning-item__point">{{ item.point }}</span>
            <span :class="confidenceClass(item.confidence)">
              <el-icon v-if="item.confidence === 'unclear'"><QuestionFilled/></el-icon>
              {{ t(`workAnalysis.confidence.${item.confidence}`) }}
            </span>
          </div>
          <div class="reasoning-item__evidence">
            <strong>{{ t('workAnalysis.evidence') }}</strong>{{ item.evidence }}
          </div>
        </li>
      </ul>
    </section>

    <!-- ── 時間分配 ───────────────────────────────────────── -->
    <section class="report-section">
      <h3 class="report-section__title">
        {{ t('workAnalysis.timeAllocation') }}
        <el-tag :type="verdictTagType" effect="plain" size="small">
          {{ t(verdictKey) }}
        </el-tag>
      </h3>
      <p class="report-section__text">{{ report.timeAllocation.comment }}</p>
    </section>

    <!-- ── 效率亮點 ───────────────────────────────────────── -->
    <section v-if="report.highlights.length > 0" class="report-section">
      <h3 class="report-section__title">{{ t('workAnalysis.highlights') }}</h3>
      <ul class="report-section__list">
        <li v-for="(item, idx) in report.highlights" :key="idx" class="report-item">
          <div class="report-item__title">{{ item.title }}</div>
          <div class="report-item__detail">{{ item.detail }}</div>
        </li>
      </ul>
    </section>

    <!-- ── 可優化點 ───────────────────────────────────────── -->
    <section v-if="report.opportunities.length > 0" class="report-section">
      <h3 class="report-section__title">{{ t('workAnalysis.opportunities') }}</h3>
      <ul class="report-section__list">
        <li v-for="(item, idx) in report.opportunities" :key="idx" class="report-item">
          <div class="report-item__title">{{ item.title }}</div>
          <div class="report-item__detail">
            <strong>{{ t('workAnalysis.opp.current') }}</strong>{{ item.currentBehavior }}
          </div>
          <div class="report-item__detail">
            <strong>{{ t('workAnalysis.opp.why') }}</strong>{{ item.whyItMatters }}
          </div>
          <div class="report-item__detail">
            <strong>{{ t('workAnalysis.opp.suggestion') }}</strong>{{ item.suggestion }}
          </div>
        </li>
      </ul>
    </section>

    <!-- ── 槓桿率評估(新增) ──────────────────────────────── -->
    <section v-if="report.leverage" class="report-section report-section--leverage">
      <h3 class="report-section__title">
        {{ t('workAnalysis.leverage') }}
        <span :class="leverageClass(report.leverage.currentLevel)">
          {{ report.leverage.currentLevel }} · {{ t(`workAnalysis.leverageLevel.${report.leverage.currentLevel}`) }}
        </span>
      </h3>
      <p class="report-section__text">{{ report.leverage.comment }}</p>
    </section>

    <!-- ── 下次建議 ───────────────────────────────────────── -->
    <section class="report-section report-section--tomorrow">
      <h3 class="report-section__title">{{ t('workAnalysis.tomorrowSuggestion') }}</h3>
      <p class="report-section__text">{{ report.tomorrowSuggestion }}</p>
    </section>
  </div>
</template>

<style scoped>
.report-content {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.report-section {
  /* sections 之間靠 .report-content gap 控,內部不再 margin */
}

.report-section--leverage {
  background: var(--el-fill-color-light);
  padding: 12px 14px;
  border-radius: 8px;
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
  flex-wrap: wrap;
  font-size: 14px;
  font-weight: 600;
  margin: 0 0 8px;
  color: var(--el-text-color-primary);
}

.report-section__hint {
  font-size: 11px;
  font-weight: 400;
  color: var(--el-text-color-secondary);
  margin-left: 2px;
}

.report-section__icon {
  color: var(--el-color-info);
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

.report-section__list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

/* ── Reasoning ──────────────────────────────────────── */

.reasoning-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.reasoning-item {
  padding: 10px 12px;
  background: var(--el-fill-color-light);
  border-radius: 8px;
  border-left: 3px solid var(--el-color-info);
}

.reasoning-item__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 4px;
}

.reasoning-item__point {
  font-size: 13px;
  font-weight: 500;
  color: var(--el-text-color-primary);
  flex: 1;
  line-height: 1.5;
}

.reasoning-item__evidence {
  font-size: 12px;
  line-height: 1.5;
  color: var(--el-text-color-secondary);
}

.reasoning-item__evidence strong {
  color: var(--el-text-color-regular);
  margin-right: 4px;
}

/* confidence 標籤 — 4 種顏色;'unclear' 最顯眼(警告色) */
.confidence-tag {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 999px;
  white-space: nowrap;
  flex-shrink: 0;
}

.confidence-tag--high {
  background: var(--el-color-success-light-8);
  color: var(--el-color-success);
}

.confidence-tag--medium {
  background: var(--el-color-primary-light-8);
  color: var(--el-color-primary);
}

.confidence-tag--low {
  background: var(--el-fill-color);
  color: var(--el-text-color-secondary);
}

.confidence-tag--unclear {
  background: var(--el-color-warning-light-8);
  color: var(--el-color-warning);
}

/* ── 一般 report item ──────────────────────────────── */

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
  margin-bottom: 2px;
}

.report-item__detail strong {
  color: var(--el-text-color-primary);
  margin-right: 4px;
}

/* ── Leverage L1-L5 顏色梯度 ───────────────────────── */

.leverage-pill {
  display: inline-flex;
  font-size: 12px;
  font-weight: 600;
  padding: 2px 10px;
  border-radius: 999px;
}

.leverage-pill--l1 {
  background: var(--el-color-info-light-8);
  color: var(--el-color-info);
}

.leverage-pill--l2 {
  background: var(--el-color-primary-light-8);
  color: var(--el-color-primary);
}

.leverage-pill--l3 {
  background: var(--el-color-warning-light-8);
  color: var(--el-color-warning);
}

.leverage-pill--l4 {
  background: var(--el-color-success-light-8);
  color: var(--el-color-success);
}

.leverage-pill--l5 {
  background: var(--el-color-danger-light-8);
  color: var(--el-color-danger);
}
</style>
