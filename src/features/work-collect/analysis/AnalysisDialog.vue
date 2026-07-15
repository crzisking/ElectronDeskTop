<script lang="ts" setup>
/**
 * 工作分析 Dialog — 三階段 UI:配置 → 流式 → 報告(階段切換在本元件內)。
 *
 * 邏輯拆到兩個 composable(SFC 只留 template + 薄接線):
 *   - useAnalysisConfig — 階段 1 配置 + 預設 prompt 準備
 *   - useAnalysisRun    — 階段切換 + 流式(StreamingController)+ 報告
 */
import {watch} from 'vue'
import {useI18n} from 'vue-i18n'
import {ArrowLeft, MagicStick, Setting, VideoPause} from '@element-plus/icons-vue'
import {useUiStore} from '@/stores/ui.store'
import {useWorkAnalysisStore} from './store'
import {useAnalysisConfig} from './useAnalysisConfig'
import {useAnalysisRun} from './useAnalysisRun'
import ReportContent from './ReportContent.vue'

const props = defineProps<{
  modelValue: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

const {t} = useI18n()
const uiStore = useUiStore()
const analysisStore = useWorkAnalysisStore()

// 階段 1 配置
const config = useAnalysisConfig()
const {
  rangeStart,
  rangeEnd,
  providers,
  activeProviderId,
  modelOverride,
  systemPrompt,
  userContent,
  recordCount,
  preparing,
  promptsExpanded,
  selectedProvider,
} = config

// 階段切換 + 流式 / 報告
const run = useAnalysisRun(config)
const {
  stage,
  streamRoot,
  streamError,
  finalReport,
  isStructured,
  canStart,
  quotaTooltip,
  parsedReport,
  handleStart,
  handleInterrupt,
  handleBackToConfigure,
} = run

// 開啟 → 初始化;關閉 → 重置
watch(() => props.modelValue, async (open) => {
  if (open) await config.init()
  else run.reset()
})

// 時間範圍變動時重抓 prompt(僅配置階段)
watch([rangeStart, rangeEnd], () => {
  if (props.modelValue && stage.value === 'configure') void config.loadPrompts()
})

function openSettings(): void {
  emit('update:modelValue', false)
  uiStore.openSettings('llm')
}

function handleClose(): void {
  emit('update:modelValue', false)
}
</script>

<template>
  <el-dialog
      :close-on-click-modal="false"
      :close-on-press-escape="stage !== 'streaming'"
      :model-value="modelValue"
      :title="t('workAnalysis.dialogTitle')"
      class="analysis-dialog"
      top="5vh"
      width="720px"
      @update:model-value="$emit('update:modelValue', $event)"
  >
    <!-- ════════════════════════ 階段 1:配置 ════════════════════════ -->
    <div v-if="stage === 'configure'" class="stage stage--configure">
      <!-- 時間 + 配額 -->
      <div class="config-row">
        <label class="config-row__label">{{ t('workAnalysis.timeRange') }}</label>
        <el-date-picker
            v-model="rangeStart"
            :placeholder="t('workAnalysis.from')"
            size="small"
            type="datetime"
        />
        <span class="dash">~</span>
        <el-date-picker
            v-model="rangeEnd"
            :placeholder="t('workAnalysis.to')"
            size="small"
            type="datetime"
        />
        <span class="config-row__quota">
          {{ t('workAnalysis.quotaLabel', {used: analysisStore.quota.used, limit: analysisStore.quota.limit}) }}
        </span>
      </div>

      <!-- Provider + Model -->
      <div v-if="providers.length > 0" class="config-row">
        <label class="config-row__label">{{ t('workAnalysis.provider') }}</label>
        <el-select v-model="activeProviderId" class="config-select" size="small">
          <el-option
              v-for="p in providers"
              :key="p.id"
              :label="p.label"
              :value="p.id"
          />
        </el-select>
        <label class="config-row__label config-row__label--inline">{{ t('workAnalysis.model') }}</label>
        <el-input
            v-model="modelOverride"
            :placeholder="selectedProvider?.model || t('workAnalysis.modelPlaceholder')"
            class="config-model"
            size="small"
        />
      </div>

      <!-- 沒 provider 引導 -->
      <el-alert
          v-else
          :closable="false"
          :title="t('workAnalysis.noProviderAlert')"
          class="config-alert"
          show-icon
          type="warning"
      >
        <template #default>
          <el-button :icon="Setting" link type="primary" @click="openSettings">
            {{ t('workAnalysis.openSettings') }}
          </el-button>
        </template>
      </el-alert>

      <!-- 紀錄數提示 -->
      <div v-if="recordCount > 0" class="config-hint">
        {{ t('workAnalysis.recordHint', {count: recordCount}) }}
      </div>
      <div v-else-if="!preparing" class="config-hint config-hint--empty">
        {{ t('workAnalysis.noRecordsInRange') }}
      </div>

      <!-- Prompt 編輯區(預設摺疊) -->
      <div class="prompts">
        <button
            class="prompts__toggle"
            type="button"
            @click="promptsExpanded = !promptsExpanded"
        >
          {{ promptsExpanded ? t('workAnalysis.hidePrompts') : t('workAnalysis.editPrompts') }}
        </button>
        <div v-if="promptsExpanded" class="prompts__body">
          <div class="prompt-field">
            <div class="prompt-field__label">{{ t('workAnalysis.systemPrompt') }}</div>
            <el-input
                v-model="systemPrompt"
                :placeholder="t('workAnalysis.systemPromptPlaceholder')"
                :rows="8"
                resize="vertical"
                type="textarea"
            />
          </div>
          <div class="prompt-field">
            <div class="prompt-field__label">{{ t('workAnalysis.userContent') }}</div>
            <el-input
                v-model="userContent"
                :placeholder="t('workAnalysis.userContentPlaceholder')"
                :rows="10"
                resize="vertical"
                type="textarea"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- ════════════════════════ 階段 2:流式 ════════════════════════ -->
    <div v-else-if="stage === 'streaming'" class="stage stage--streaming">
      <div class="streaming-header">
        <span class="streaming-spinner">
          <el-icon class="is-loading"><MagicStick/></el-icon>
        </span>
        <span>{{ streamError ? t('workAnalysis.streamError') : t('workAnalysis.streamingHint') }}</span>
      </div>

      <!-- vanilla DOM 掛載點(StreamingController 直接動裡面 textContent) -->
      <div ref="streamRoot" class="stream-area"></div>

      <el-alert
          v-if="streamError"
          :closable="false"
          :title="streamError"
          class="stream-error"
          show-icon
          type="error"
      />
    </div>

    <!-- ════════════════════════ 階段 3:報告 ════════════════════════ -->
    <div v-else-if="stage === 'result' && finalReport" class="stage stage--result">
      <!-- meta header -->
      <div class="result-header">
        <span class="meta-chip">{{ t('workAnalysis.recordsCount', {count: finalReport.recordCount}) }}</span>
        <span class="meta-chip meta-chip--provider">
          {{ finalReport.providerLabel }} · {{ finalReport.modelUsed }}
        </span>
        <span v-if="finalReport.inputTokens || finalReport.outputTokens" class="meta-chip">
          {{ t('workAnalysis.tokens', {input: finalReport.inputTokens ?? 0, output: finalReport.outputTokens ?? 0}) }}
        </span>
      </div>

      <!-- unstructured fallback -->
      <template v-if="!isStructured">
        <el-alert
            :closable="false"
            :title="t('workAnalysis.unstructuredWarning')"
            class="result-warning"
            show-icon
            type="warning"
        />
        <pre class="result-raw">{{ finalReport.reportJson }}</pre>
      </template>

      <!-- structured — 走共用 ReportContent 元件,內含 reasoning / leverage 等所有新區塊 -->
      <ReportContent v-else-if="parsedReport" :report="parsedReport"/>
    </div>

    <!-- ════════════════════════ footer ════════════════════════ -->
    <template #footer>
      <!-- 配置階段 -->
      <template v-if="stage === 'configure'">
        <el-button @click="handleClose">{{ t('common.cancel') }}</el-button>
        <el-tooltip
            :content="quotaTooltip"
            :disabled="!quotaTooltip"
            placement="top"
        >
          <el-button
              :disabled="!canStart"
              :icon="MagicStick"
              type="primary"
              @click="handleStart"
          >
            {{ t('workAnalysis.startAnalyze') }}
          </el-button>
        </el-tooltip>
      </template>
      <!-- 流式階段 -->
      <template v-else-if="stage === 'streaming'">
        <el-button v-if="streamError" :icon="ArrowLeft" @click="handleBackToConfigure">
          {{ t('workAnalysis.backToConfig') }}
        </el-button>
        <el-button
            v-else
            :icon="VideoPause"
            plain
            type="danger"
            @click="handleInterrupt"
        >
          {{ t('workAnalysis.interrupt') }}
        </el-button>
      </template>
      <!-- 報告階段 -->
      <template v-else>
        <el-button :icon="ArrowLeft" @click="handleBackToConfigure">
          {{ t('workAnalysis.analyzeAgain') }}
        </el-button>
        <el-button type="primary" @click="handleClose">{{ t('common.close') }}</el-button>
      </template>
    </template>
  </el-dialog>
</template>

<style scoped>
/* ── Dialog 整體限高 + header / footer 固定 / body 內部捲動 ─────────
 *
 * 預設 el-dialog 高度自動,內容多就把 dialog 撐到比視窗還高,變成「外層 viewport
 * 捲動 整個 modal」,UX 很差。
 *
 * 改成:
 *   .el-dialog          整體 max-height 85vh + flex column
 *   .el-dialog__header  自然高度,固定
 *   .el-dialog__body    flex: 1 + overflow auto + min-height: 0,內部才會 scroll
 *   .el-dialog__footer  自然高度,固定
 *
 * .stage 拿掉 max-height + overflow — 改由外層 body 接管捲動,內部單純 flex content。
 */
.analysis-dialog :deep(.el-dialog) {
  max-height: 85vh;
  display: flex;
  flex-direction: column;
}

.analysis-dialog :deep(.el-dialog__body) {
  flex: 1;
  min-height: 0; /* 沒這條,flex item 預設 min-height: auto,body 撐爆不會 scroll */
  overflow: auto;
  padding-top: 12px;
}

/* 三階段公用 — header/footer 已固定,本層只負責內容垂直排版,不再吃 scroll */
.stage {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-height: 320px;
}

/* ── 配置階段 ───────────────────────────────────────────── */
.config-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.config-row__label {
  font-size: 13px;
  font-weight: 500;
  color: var(--el-text-color-primary);
  white-space: nowrap;
}

.config-row__label--inline {
  margin-left: 12px;
}

.config-row__quota {
  margin-left: auto;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.dash {
  color: var(--el-text-color-secondary);
}

.config-select {
  min-width: 180px;
}

.config-model {
  flex: 1;
  min-width: 160px;
}

.config-alert {
  margin: 4px 0;
}

.config-hint {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  padding: 6px 10px;
  background: var(--el-fill-color-light);
  border-radius: 6px;
}

.config-hint--empty {
  color: var(--el-color-warning);
  background: var(--el-color-warning-light-9);
}

.prompts {
  border-top: 1px solid var(--el-border-color-lighter);
  padding-top: 10px;
}

.prompts__toggle {
  background: transparent;
  border: none;
  color: var(--el-color-primary);
  cursor: pointer;
  font-size: 13px;
  padding: 4px 0;
}

.prompts__toggle:hover {
  text-decoration: underline;
}

.prompts__body {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.prompt-field__label {
  font-size: 12px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  margin-bottom: 4px;
}

/* ── 流式階段 ───────────────────────────────────────────── */
.streaming-header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.streaming-spinner {
  display: inline-flex;
  color: var(--el-color-primary);
}

/* StreamingController 會往這裡 appendChild 一個 <pre class="stream-text"> */
.stream-area {
  flex: 1;
  min-height: 280px;
  max-height: 50vh;
  overflow: auto;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  padding: 12px;
  background: var(--el-fill-color-light);
}

.stream-area :deep(.stream-text) {
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--el-text-color-primary);
  font-family: var(--el-font-family-mono, ui-monospace, 'SF Mono', Menlo, monospace);
}

.stream-error {
  margin-top: 8px;
}

/* ── 報告階段 ───────────────────────────────────────────── */
.result-header {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.meta-chip {
  font-size: 12px;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--el-fill-color-light);
  color: var(--el-text-color-secondary);
}

.meta-chip--provider {
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
}

.result-warning {
  margin-bottom: 8px;
}

.result-raw {
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
  margin-bottom: 14px;
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

.report-section__list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 10px;
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
  margin-bottom: 2px;
}

.report-item__detail strong {
  color: var(--el-text-color-primary);
  margin-right: 4px;
}
</style>
