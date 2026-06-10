<!--
  團隊視圖(docs/20 §5.6)— 主管查下屬工作狀態的入口。

  佈局:
   - 頂欄:返回 + 「AI 摘要」(範圍=全部下屬,後端按主管自動解析,4h cache)
   - 左欄:下屬列表(姓名/工號 + 最後匯報時間,久未匯報標橙)
   - 右欄:選中下屬後顯示其「近期匯報」+「進行中備忘」

  匯報互動(本次重做核心):
   - 點匯報行 → 抽屜顯示完整內容(三段分區,「需要協助」紅標)
   - 抽屜底部可直接寫回饋 → createFeedback(report)→ 後端推 SignalR,下屬端紅點
-->
<template>
  <div class="team-view">
    <header class="page-header">
      <el-button size="small" @click="goBack">← {{ $t('common.back') }}</el-button>
      <h3>{{ $t('projectFlow.team.subordinates') }}</h3>
      <el-button :disabled="!subordinates.length" :loading="aiLoading" class="ai-btn" @click="onAiSummary">
        {{ $t('projectFlow.team.aiSummary') }}
      </el-button>
    </header>

    <div class="content">
      <aside v-loading="loadingSub" class="sub-list">
        <el-empty v-if="!subordinates.length" :description="$t('projectFlow.team.noSub')"/>
        <div
            v-for="s in subordinates"
            :key="s.userId"
            :class="['sub-item', {active: selected === s.userId}]"
            @click="onSelect(s.userId)"
        >
          <div class="sub-name">{{ s.name || s.userId }}</div>
          <div class="sub-id">{{ s.userId }}</div>
          <div :class="{stale: isStale(s.lastReportAt)}" class="sub-meta">
            {{ lastReportText(s.lastReportAt) }}
          </div>
        </div>
      </aside>

      <main class="detail">
        <div v-if="aiText" class="ai-block">
          <h5>{{ $t('projectFlow.team.aiSummary') }}</h5>
          <pre>{{ aiText }}</pre>
        </div>

        <template v-if="selected">
          <section class="block">
            <h4>{{ $t('projectFlow.team.recentReports') }}</h4>
            <el-table :data="subReports" size="small" stripe @row-click="openReport">
              <el-table-column :label="$t('projectFlow.reports.titleCol')" prop="title"/>
              <el-table-column :label="$t('common.status')" width="100">
                <template #default="{row}">
                  <el-tag :type="row.status === 'submitted' ? 'success' : 'info'" size="small">
                    {{ $t(`projectFlow.reports.status.${row.status}`) }}
                  </el-tag>
                </template>
              </el-table-column>
              <el-table-column :label="$t('projectFlow.reports.updatedAt')" width="170">
                <template #default="{row}">{{ formatTime(row.submittedAt ?? row.createdAt) }}</template>
              </el-table-column>
            </el-table>
          </section>

          <section class="block">
            <h4>{{ $t('projectFlow.team.openMemos') }}</h4>
            <el-table :data="subMemos" size="small" stripe>
              <el-table-column :label="$t('projectFlow.memos.titleCol')" prop="title"/>
              <el-table-column :label="$t('projectFlow.memos.description')" prop="description" show-overflow-tooltip/>
              <el-table-column :label="$t('common.status')" width="100">
                <template #default="{row}">{{ $t(`projectFlow.memos.status.${row.status}`) }}</template>
              </el-table-column>
            </el-table>
          </section>
        </template>

        <el-empty v-else :description="$t('projectFlow.team.pickSub')"/>
      </main>
    </div>

    <!-- 匯報詳情抽屜:三段分區 + 回饋輸入 -->
    <el-drawer v-model="drawerVisible" :title="reportDetail?.title" size="480px">
      <div v-loading="loadingReport" class="report-detail">
        <template v-for="sec in REPORT_SECTIONS" :key="sec.type">
          <template v-if="itemsOf(sec.type).length">
            <h4>{{ sec.icon }} {{ $t(sec.titleKey) }}</h4>
            <ul class="rpt-items">
              <li v-for="it in itemsOf(sec.type)" :key="it.itemId">
                {{ it.content }}
                <el-tag v-if="it.needHelp" size="small" type="danger">{{ $t('projectFlow.reports.needHelp') }}</el-tag>
              </li>
            </ul>
          </template>
        </template>

        <!-- 歷史回饋 + 新回饋 -->
        <h4>💬 {{ $t('projectFlow.team.feedback') }}</h4>
        <ul v-if="feedbacks.length" class="fb-list">
          <li v-for="f in feedbacks" :key="f.feedbackId">
            <span class="fb-from">{{ f.fromUserId }}</span> {{ f.content }}
            <span class="fb-time">{{ formatTime(f.createdAt) }}</span>
          </li>
        </ul>
        <el-input
            v-model="feedbackText"
            :placeholder="$t('projectFlow.team.feedbackPlaceholder')"
            :rows="3"
            type="textarea"
        />
        <el-button
            :disabled="!feedbackText.trim()"
            :loading="sendingFeedback"
            class="fb-send"
            type="primary"
            @click="onSendFeedback"
        >
          {{ $t('projectFlow.team.sendFeedback') }}
        </el-button>
      </div>
    </el-drawer>
  </div>
</template>

<script lang="ts" setup>
import {computed, onMounted, ref} from 'vue'
import {useRouter} from 'vue-router'
import {useI18n} from 'vue-i18n'
import {ElMessage} from 'element-plus'
import {projectFlowApi} from './api'
import type {
  FeedbackResponse,
  MemoResponse,
  PagedResult,
  ReportResponse,
  ReportSummaryItem,
  TeamSubordinateItem,
} from './types'

const {t} = useI18n()
const router = useRouter()

/** 返回 = 回上一級(個人功能)。不走 history.back — 那會跳去使用者上次逛的任意頁 */
function goBack() {
  router.push({name: 'personal-functions'})
}

// ─── 下屬列表 ────────────────────────────────────────────────

const subordinates = ref<TeamSubordinateItem[]>([])
const selected = ref<string>('')
const subReports = ref<ReportSummaryItem[]>([])
const subMemos = ref<MemoResponse[]>([])
const loadingSub = ref(false)

const STALE_MS = 3 * 86_400_000 // 超過 3 天沒匯報 → 橙色提醒

onMounted(loadSubs)

async function loadSubs() {
  loadingSub.value = true
  try {
    subordinates.value = ((await projectFlowApi.listSubordinates()) as TeamSubordinateItem[]) ?? []
  } catch (err) {
    ElMessage.error((err as Error).message)
  } finally {
    loadingSub.value = false
  }
}

async function onSelect(userId: string) {
  selected.value = userId
  try {
    // 後端 PagedResult 的清單欄位是 list(對齊 PagedResult.cs)
    const reports = (await projectFlowApi.listSubReports(userId, {
      pageIndex: 1,
      pageSize: 20
    })) as PagedResult<ReportSummaryItem[]>
    subReports.value = reports?.list ?? []
    subMemos.value = ((await projectFlowApi.listSubMemos(userId)) as MemoResponse[]) ?? []
  } catch (err) {
    ElMessage.error((err as Error).message)
  }
}

function isStale(ms?: number): boolean {
  return !ms || Date.now() - ms > STALE_MS
}

function lastReportText(ms?: number): string {
  return ms ? t('projectFlow.team.lastReport', {time: formatTime(ms)}) : t('projectFlow.team.neverReported')
}

// ─── 匯報詳情抽屜 + 回饋 ─────────────────────────────────────

const REPORT_SECTIONS = [
  {type: 'work', icon: '📝', titleKey: 'projectFlow.reports.sectionWork'},
  {type: 'issue', icon: '⚠️', titleKey: 'projectFlow.reports.sectionIssue'},
  {type: 'plan', icon: '📅', titleKey: 'projectFlow.reports.sectionPlan'},
] as const

const drawerVisible = ref(false)
const loadingReport = ref(false)
const reportDetail = ref<ReportResponse | null>(null)
const feedbacks = ref<FeedbackResponse[]>([])
const feedbackText = ref('')
const sendingFeedback = ref(false)

const itemsOf = computed(() => (type: string) =>
    (reportDetail.value?.items ?? []).filter((i) => i.itemType === type))

async function openReport(row: ReportSummaryItem) {
  drawerVisible.value = true
  loadingReport.value = true
  feedbackText.value = ''
  try {
    reportDetail.value = (await projectFlowApi.getReport(row.reportId)) as ReportResponse
    feedbacks.value = ((await projectFlowApi.listFeedbackByTarget('report', row.reportId)) as FeedbackResponse[]) ?? []
  } catch (err) {
    ElMessage.error((err as Error).message)
    drawerVisible.value = false
  } finally {
    loadingReport.value = false
  }
}

/** 回饋寫給匯報作者;後端會推 SignalR,下屬端 FeedbackDrawer 紅點 +1 */
async function onSendFeedback() {
  if (!reportDetail.value) return
  sendingFeedback.value = true
  try {
    await projectFlowApi.createFeedback({
      targetType: 'report',
      targetId: reportDetail.value.reportId,
      toUserId: reportDetail.value.userId,
      content: feedbackText.value.trim(),
    })
    feedbackText.value = ''
    feedbacks.value = ((await projectFlowApi.listFeedbackByTarget('report', reportDetail.value.reportId)) as FeedbackResponse[]) ?? []
    ElMessage.success(t('projectFlow.team.feedbackSent'))
  } catch (err) {
    ElMessage.error((err as Error).message)
  } finally {
    sendingFeedback.value = false
  }
}

// ─── AI 團隊摘要(範圍=全部下屬;contentJson 解析見 formatTeamSummary) ──

const aiText = ref('')
const aiLoading = ref(false)

async function onAiSummary() {
  aiLoading.value = true
  try {
    const r = (await projectFlowApi.aiTeamSummary({force: false})) as {
      ok: boolean
      contentJson?: string
      error?: string
    }
    if (!r?.ok) {
      ElMessage.error(r?.error || t('projectFlow.team.aiFailed'))
      return
    }
    aiText.value = formatTeamSummary(r.contentJson ?? '')
  } catch (err) {
    ElMessage.error((err as Error).message)
  } finally {
    aiLoading.value = false
  }
}

/** contentJson({overallProgress, highlights[], blockers[], suggestedActions[]})→ 可讀文字;解析失敗原樣顯示 */
function formatTeamSummary(contentJson: string): string {
  try {
    const c = JSON.parse(contentJson) as {
      overallProgress?: string
      highlights?: string[]
      blockers?: string[]
      suggestedActions?: string[]
    }
    const lines: string[] = []
    if (c.overallProgress) lines.push(c.overallProgress)
    const sec = (label: string, items?: string[]) => {
      if (items?.length) lines.push('', `【${label}】`, ...items.map((s) => `• ${s}`))
    }
    sec(t('projectFlow.team.highlights'), c.highlights)
    sec(t('projectFlow.team.blockers'), c.blockers)
    sec(t('projectFlow.team.suggestedActions'), c.suggestedActions)
    return lines.join('\n') || contentJson
  } catch {
    return contentJson
  }
}

function formatTime(ms?: number | null): string {
  return ms ? new Date(ms).toLocaleString() : '-'
}
</script>

<style scoped>
.team-view {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.page-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid #e4e7ed;
  background: #fff;
}

.page-header h3 {
  margin: 0;
}

.ai-btn {
  margin-left: auto;
}

.content {
  display: flex;
  flex: 1;
  overflow: hidden;
}

.sub-list {
  width: 230px;
  border-right: 1px solid #e4e7ed;
  padding: 12px;
  overflow: auto;
}

.sub-item {
  padding: 8px 12px;
  border-radius: 6px;
  cursor: pointer;
  margin-bottom: 4px;
}

.sub-item:hover {
  background: #f5f7fa;
}

.sub-item.active {
  background: #ecf5ff;
  color: #409eff;
}

.sub-name {
  font-weight: 600;
}

.sub-id {
  font-size: 12px;
  color: #909399;
}

.sub-meta {
  font-size: 12px;
  color: #67c23a;
  margin-top: 2px;
}

.sub-meta.stale {
  color: #e6a23c;
}

.detail {
  flex: 1;
  overflow: auto;
  padding: 16px;
}

.block {
  margin-bottom: 24px;
}

.ai-block {
  background: #f5f7fa;
  padding: 12px;
  border-radius: 6px;
  margin-bottom: 16px;
}

.ai-block pre {
  white-space: pre-wrap;
  margin: 0;
  font-family: inherit;
}

.report-detail h4 {
  margin: 14px 0 6px;
  font-size: 13px;
}

.rpt-items {
  padding-left: 18px;
  margin: 0;
  font-size: 13px;
  line-height: 1.8;
}

.fb-list {
  list-style: none;
  padding: 0;
  margin: 0 0 10px;
  font-size: 13px;
}

.fb-list li {
  padding: 6px 0;
  border-bottom: 1px dashed #f0f0f0;
}

.fb-from {
  font-weight: 600;
  margin-right: 6px;
}

.fb-time {
  float: right;
  color: #909399;
  font-size: 12px;
}

.fb-send {
  margin-top: 8px;
}
</style>
