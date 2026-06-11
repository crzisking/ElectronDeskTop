<!--
  匯報編輯器(docs/20 §5.4)。

  分區(對齊後端 ReportItem.itemType):
   - 📝 今日工作 (work):可獨立寫,也可用每條右下的 cascader 關聯到「項目 → 節點」
   - ⚠️ 遇到的問題 (issue):可勾「需要協助」→ 主管端紅點高亮
   - 📅 明日計畫 (plan)

  右側參考欄:
   - 「今日工作數據」:本地 work-collect 聚合(類別/分鐘/應用),唯讀,給自己參考著寫
   - 「AI 寫作建議」:教練模式 — 看你已寫的草稿 + 今日數據,回 思路/潤色/遺漏,
     一律不代寫不自動填,要不要採納由自己改

  保存規則:draft 可隨時存;提交後唯讀,後端推 SignalR 給主管。
-->
<template>
  <div v-loading="loading" class="report-editor-view">
    <header class="header">
      <!-- 返回 = 回匯報列表(上一級),不走瀏覽歷史 -->
      <el-button size="small" @click="$router.push({name: 'project-reports'})">← {{ $t('common.back') }}</el-button>
      <el-input
          v-model="form.title"
          :disabled="readonly"
          :placeholder="$t('projectFlow.reports.titlePh')"
          class="title-input"
      />
      <el-tag :type="report?.status === 'submitted' ? 'success' : 'info'" size="small">
        {{ $t(`projectFlow.reports.status.${report?.status ?? 'draft'}`) }}
      </el-tag>
      <div class="actions">
        <el-button :disabled="readonly" :loading="aiLoading" @click="onAiAdvice">
          {{ $t('projectFlow.reports.aiAdvice') }}
        </el-button>
        <el-button :disabled="readonly" plain type="primary" @click="onSave">{{ $t('common.save') }}</el-button>
        <el-button :disabled="readonly" type="primary" @click="onSubmit">{{
            $t('projectFlow.reports.submit')
          }}
        </el-button>
      </div>
    </header>

    <main class="body">
      <div class="sections">
        <ReportSection
            v-for="cfg in SECTIONS"
            :key="cfg.type"
            :empty-text="$t(cfg.emptyKey)"
            :icon="cfg.icon"
            :items="itemsByType[cfg.type]"
            :placeholder="$t(cfg.placeholderKey)"
            :readonly="readonly"
            :show-need-help="cfg.type === 'issue'"
            :title="$t(cfg.titleKey)"
            @add="addItem(cfg.type)"
            @remove="removeItem"
        />
      </div>

      <!-- 右側參考欄:唯讀數據 + AI 建議,都「只看不填」 -->
      <aside class="ref-panel">
        <section class="ref-block">
          <h4>{{ $t('projectFlow.reports.todayData') }}</h4>
          <p class="ref-hint">{{ $t('projectFlow.reports.todayDataHint') }}</p>
          <el-empty v-if="!activity.length" :description="$t('projectFlow.reports.todayDataEmpty')" :image-size="48"/>
          <ul v-else class="act-list">
            <li v-for="a in activity" :key="a.category">
              <span class="act-cat">{{ a.category }}</span>
              <span class="act-min">{{ $t('projectFlow.reports.minutes', {n: a.minutes}) }}</span>
              <div class="act-apps">{{ a.apps.join('、') }}</div>
            </li>
          </ul>
        </section>

        <section v-if="advice" class="ref-block">
          <h4>{{ $t('projectFlow.reports.adviceTitle') }}</h4>
          <template v-if="advice.ideas?.length">
            <h5>💡 {{ $t('projectFlow.reports.adviceIdeas') }}</h5>
            <ul class="advice-list">
              <li v-for="(s, i) in advice.ideas" :key="i">{{ s }}</li>
            </ul>
          </template>
          <template v-if="advice.polish?.length">
            <h5>✏️ {{ $t('projectFlow.reports.advicePolish') }}</h5>
            <ul class="advice-list">
              <li v-for="(p, i) in advice.polish" :key="i">
                <div class="polish-orig">「{{ p.original }}」</div>
                <div>→ {{ p.suggestion }}</div>
              </li>
            </ul>
          </template>
          <template v-if="advice.missing?.length">
            <h5>🔍 {{ $t('projectFlow.reports.adviceMissing') }}</h5>
            <ul class="advice-list">
              <li v-for="(s, i) in advice.missing" :key="i">{{ s }}</li>
            </ul>
          </template>
        </section>
      </aside>
    </main>
  </div>
</template>

<script lang="ts" setup>
import {computed, onMounted, reactive, ref} from 'vue'
import {useRoute} from 'vue-router'
import {ElMessage, ElMessageBox} from 'element-plus'
import {useI18n} from 'vue-i18n'
import {projectFlowApi} from './api'
import type {AiReportAdvice, ReportItemResponse, ReportResponse, TodayActivityCategory} from './types'
import ReportSection from './components/ReportSection.vue'

const route = useRoute()
const {t} = useI18n()
const loading = ref(false)
const aiLoading = ref(false)
const report = ref<ReportResponse | null>(null)

const form = reactive<{ title: string; items: ReportItemResponse[] }>({title: '', items: []})

// 右側參考欄狀態
const activity = ref<TodayActivityCategory[]>([])
const advice = ref<AiReportAdvice | null>(null)

const readonly = computed(() => report.value?.status === 'submitted')

/** Section 配置 — 順序即顯示順序;type 對齊後端 ReportItem.itemType 枚舉 */
const SECTIONS = [
  {
    type: 'work', titleKey: 'projectFlow.reports.sectionWork', icon: '📝',
    placeholderKey: 'projectFlow.reports.placeholderWork', emptyKey: 'projectFlow.reports.emptyWork'
  },
  {
    type: 'issue', titleKey: 'projectFlow.reports.sectionIssue', icon: '⚠️',
    placeholderKey: 'projectFlow.reports.placeholderIssue', emptyKey: 'projectFlow.reports.emptyIssue'
  },
  {
    type: 'plan', titleKey: 'projectFlow.reports.sectionPlan', icon: '📅',
    placeholderKey: 'projectFlow.reports.placeholderPlan', emptyKey: 'projectFlow.reports.emptyPlan'
  },
] as const

/** 派發 items 給三段;reactive 自動跟著 form.items 變動 */
const itemsByType = computed(() => ({
  work: form.items.filter((i) => i.itemType === 'work'),
  issue: form.items.filter((i) => i.itemType === 'issue'),
  plan: form.items.filter((i) => i.itemType === 'plan'),
}))

onMounted(() => {
  void load()
  void loadActivity()
})

/** 今日數據純本地讀取,失敗不打擾(參考欄留空即可) */
async function loadActivity() {
  try {
    activity.value = (await projectFlowApi.todayActivity()).categories
  } catch {
    activity.value = []
  }
}

async function load() {
  loading.value = true
  try {
    const id = Number(route.params.reportId)
    const r = await projectFlowApi.getReport(id)
    report.value = r
    form.title = r.title ?? ''
    form.items = (r.items ?? []).map((it) => ({...it}))
  } catch (err) {
    ElMessage.error((err as Error).message)
  } finally {
    loading.value = false
  }
}

function addItem(itemType: 'work' | 'issue' | 'plan') {
  form.items.push({
    itemId: 0,
    reportId: report.value?.reportId ?? 0,
    itemType,
    content: '',
    needHelp: false,
    sortOrder: form.items.length,
  } as ReportItemResponse)
}

/** 透過 itemId 找回 form.items 真正的 index 再 splice(避免 v-for index 對不上過濾後的子集合) */
function removeItem(item: ReportItemResponse) {
  const idx = form.items.indexOf(item)
  if (idx >= 0) form.items.splice(idx, 1)
}

async function onSave() {
  try {
    await projectFlowApi.updateReport(report.value!.reportId, {title: form.title, items: form.items})
    ElMessage.success(t('common.saveSuccess'))
  } catch (err) {
    ElMessage.error((err as Error).message)
  }
}

async function onSubmit() {
  try {
    await ElMessageBox.confirm(t('projectFlow.reports.submitConfirm'), t('common.warning'), {type: 'warning'})
    await projectFlowApi.updateReport(report.value!.reportId, {title: form.title, items: form.items})
    await projectFlowApi.submitReport(report.value!.reportId)
    await load()
    ElMessage.success(t('projectFlow.reports.submitted'))
  } catch (err) {
    if (err === 'cancel') return
    ElMessage.error((err as Error).message ?? String(err))
  }
}

/**
 * AI 寫作建議(教練模式)。
 * 把目前草稿三段的文字送給本地 LLM,回 {ideas, polish, missing} 顯示在右側參考欄。
 * 刻意不提供「一鍵套用」— 匯報要自己寫,AI 只給思路。
 */
async function onAiAdvice() {
  aiLoading.value = true
  try {
    const pick = (type: string) =>
        form.items.filter((i) => i.itemType === type && i.content.trim()).map((i) => i.content)
    advice.value = (await projectFlowApi.aiReportAdvice({
      work: pick('work'),
      issue: pick('issue'),
      plan: pick('plan'),
    }))
  } catch (err) {
    ElMessage.error((err as Error).message)
  } finally {
    aiLoading.value = false
  }
}
</script>

<style scoped>
.report-editor-view {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid #e4e7ed;
  background: #fff;
}

.title-input {
  flex: 1;
  max-width: 480px;
}

.actions {
  margin-left: auto;
  display: flex;
  gap: 8px;
}

.body {
  flex: 1;
  padding: 16px;
  overflow: hidden;
  background: #fafbfc;
  display: flex;
  gap: 16px;
}

.sections {
  flex: 1;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* 右側參考欄 — 唯讀,寬度固定不擠正文 */
.ref-panel {
  width: 300px;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.ref-block {
  background: #fff;
  border: 1px solid #e4e7ed;
  border-radius: 8px;
  padding: 12px 14px;
}

.ref-block h4 {
  margin: 0 0 4px;
  font-size: 13px;
  color: #303133;
}

.ref-block h5 {
  margin: 10px 0 4px;
  font-size: 12px;
  color: #606266;
}

.ref-hint {
  font-size: 12px;
  color: #909399;
  margin: 0 0 8px;
}

.act-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.act-list li {
  padding: 6px 0;
  border-bottom: 1px dashed #f0f0f0;
  font-size: 12px;
}

.act-cat {
  font-weight: 600;
  color: #303133;
}

.act-min {
  float: right;
  color: #409eff;
}

.act-apps {
  color: #909399;
  margin-top: 2px;
}

.advice-list {
  padding-left: 16px;
  margin: 4px 0;
  font-size: 12px;
  color: #303133;
  line-height: 1.6;
}

.polish-orig {
  color: #909399;
}
</style>
