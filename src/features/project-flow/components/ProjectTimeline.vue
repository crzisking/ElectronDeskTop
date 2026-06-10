<!--
  項目時間線視圖 — 與畫布同數據(detail.nodes),按截止日排序的垂直時間線。

  回答兩個問題:「這個項目接下來的時間安排是什麼」「每件事誰負責」。
  - 有截止日的節點按日期升序;逾期紅、7 天內橙、其餘藍
  - 沒截止日的節點集中放最後的「未排期」區,提醒去補日期
  - 點任一節點 emit select,父元件開 NodeInspector(跟畫布同一套編輯)
-->
<template>
  <div class="timeline-view">
    <el-empty v-if="!nodes.length" :description="$t('projectFlow.timeline.empty')"/>

    <template v-else>
      <el-timeline class="tl">
        <el-timeline-item
            v-for="n in scheduled"
            :key="n.nodeId"
            :timestamp="formatDate(n.deadline!)"
            :type="timelineType(n)"
            placement="top"
        >
          <div :class="`st-${n.status}`" class="tl-card" @click="$emit('select', n)">
            <div class="tl-head">
              <span class="tl-title">{{ n.title }}</span>
              <el-tag :type="statusTagType(n.status)" size="small">
                {{ $t(`projectFlow.nodeStatus.${n.status}`) }}
              </el-tag>
            </div>
            <div class="tl-meta">
              <span v-if="n.assigneeUserId">👤 {{ n.assigneeUserId }}</span>
              <span v-else class="warn">⚠ {{ $t('projectFlow.timeline.noAssignee') }}</span>
              <span :class="{overdue: isOverdue(n)}">{{ daysLeftText(n) }}</span>
            </div>
          </div>
        </el-timeline-item>
      </el-timeline>

      <!-- 未排期:沒截止日的節點;時間線上看不到,提醒補日期 -->
      <section v-if="unscheduled.length" class="unscheduled">
        <h4>{{ $t('projectFlow.timeline.unscheduled') }}({{ unscheduled.length }})</h4>
        <div v-for="n in unscheduled" :key="n.nodeId" class="tl-card" @click="$emit('select', n)">
          <div class="tl-head">
            <span class="tl-title">{{ n.title }}</span>
            <el-tag :type="statusTagType(n.status)" size="small">
              {{ $t(`projectFlow.nodeStatus.${n.status}`) }}
            </el-tag>
          </div>
          <div class="tl-meta">
            <span v-if="n.assigneeUserId">👤 {{ n.assigneeUserId }}</span>
            <span class="warn">{{ $t('projectFlow.timeline.noDeadlineHint') }}</span>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>

<script lang="ts" setup>
import {computed} from 'vue'
import {useI18n} from 'vue-i18n'
import type {NodeResponse} from '../types'

const props = defineProps<{ nodes: NodeResponse[] }>()
defineEmits<{ select: [node: NodeResponse] }>()

const {t} = useI18n()

const DAY = 86_400_000

// 已完成/取消的節點不擋視線,排到對應日期但弱化;進行中按截止日排
const scheduled = computed(() =>
    props.nodes.filter((n) => n.deadline).sort((a, b) => (a.deadline ?? 0) - (b.deadline ?? 0)),
)
const unscheduled = computed(() => props.nodes.filter((n) => !n.deadline))

function isDone(n: NodeResponse) {
  return n.status === 'completed' || n.status === 'cancelled'
}

function isOverdue(n: NodeResponse) {
  return !isDone(n) && !!n.deadline && n.deadline < Date.now()
}

/** 時間線圓點顏色:逾期紅 / 7 天內橙 / 完成綠 / 其餘藍 */
function timelineType(n: NodeResponse): 'danger' | 'warning' | 'success' | 'primary' {
  if (isDone(n)) return 'success'
  if (isOverdue(n)) return 'danger'
  if (n.deadline! - Date.now() < 7 * DAY) return 'warning'
  return 'primary'
}

function statusTagType(s: string): 'success' | 'warning' | 'danger' | 'info' | 'primary' {
  return ({completed: 'success', in_progress: 'primary', blocked: 'danger', cancelled: 'info'} as const)[s] ?? 'info'
}

function formatDate(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 「剩 N 天 / 逾期 N 天 / 今天到期」 */
function daysLeftText(n: NodeResponse): string {
  if (isDone(n) || !n.deadline) return ''
  const diff = Math.ceil((n.deadline - Date.now()) / DAY)
  if (diff < 0) return t('projectFlow.timeline.overdueDays', {n: -diff})
  if (diff === 0) return t('projectFlow.timeline.dueToday')
  return t('projectFlow.timeline.daysLeft', {n: diff})
}
</script>

<style scoped>
.timeline-view {
  height: 100%;
  overflow-y: auto;
  padding: 20px 24px;
}

.tl {
  max-width: 560px;
}

.tl-card {
  border: 1px solid #e4e7ed;
  border-radius: 8px;
  padding: 10px 12px;
  cursor: pointer;
  transition: box-shadow 0.15s;
  background: #fff;
}

.tl-card:hover {
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
  border-color: #409eff;
}

.tl-card.st-completed, .tl-card.st-cancelled {
  opacity: 0.6;
}

.tl-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.tl-title {
  font-weight: 600;
  color: #303133;
}

.tl-meta {
  display: flex;
  gap: 16px;
  margin-top: 6px;
  font-size: 12px;
  color: #606266;
}

.tl-meta .warn {
  color: #e6a23c;
}

.tl-meta .overdue {
  color: #f56c6c;
  font-weight: 600;
}

.unscheduled {
  max-width: 560px;
  margin-top: 8px;
}

.unscheduled h4 {
  color: #909399;
  font-size: 13px;
  margin: 12px 0 8px;
}

.unscheduled .tl-card {
  margin-bottom: 8px;
}
</style>
