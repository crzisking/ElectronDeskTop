<!--
  畫布右側 Inspector — 取代右鍵 prompt 的所有節點操作。

  選中節點後:
   - 看 / 改 標題、描述、狀態(狀態用 EP el-select 五選一)
   - 看「掛在這節點上的匯報項目」(reportItems WHERE nodeId = me)
     each item 顯示作者 / 標題 / 內容 / 類型(work/issue/plan)
     點 item → 跳到該匯報編輯頁
   - 刪除節點按鈕(危險動作放底部)

  狀態管理:
   - 父元件透過 v-model:selected-node 把選中的 NodeResponse 傳進來
   - 編輯時走 update + emit 通知父刷新畫布上的 label
   - 刪除 emit 'delete' 讓父呼後端 + 從 graph 移除
-->
<template>
  <aside v-if="node" class="inspector">
    <header class="ins-header">
      <span class="ins-title">{{ $t('projectFlow.node.detailTitle') }}</span>
      <el-button :icon="Close" link size="small" @click="$emit('close')"/>
    </header>

    <!-- readonly(viewer 角色)時整個表單禁用,只能看 -->
    <el-form :disabled="readonly" class="ins-form" label-position="top" size="small">
      <el-form-item :label="$t('projectFlow.reports.titleCol')">
        <el-input v-model="form.title" @blur="onTitleBlur"/>
      </el-form-item>

      <el-form-item :label="$t('common.status')">
        <el-select v-model="form.status" @change="onStatusChange">
          <el-option
              v-for="s in STATUS_OPTIONS"
              :key="s.value"
              :label="s.label"
              :value="s.value"
          >
            <span :style="{color: s.color}">● </span>{{ s.label }}
          </el-option>
        </el-select>
      </el-form-item>

      <!-- 時間線核心欄位:截止日 + 負責人。沒有這兩個,項目時間線就是空的 -->
      <el-form-item :label="$t('projectFlow.node.deadline')">
        <el-date-picker
            v-model="form.deadline"
            :placeholder="$t('projectFlow.node.deadlinePlaceholder')"
            style="width: 100%"
            type="date"
            @change="onDeadlineChange"
        />
      </el-form-item>

      <el-form-item :label="$t('projectFlow.node.assignee')">
        <el-input :model-value="form.assigneeUserId" :placeholder="$t('projectFlow.node.assigneePlaceholder')" readonly>
          <template #append>
            <el-button @click="empDialogVisible = true">{{ $t('common.select') }}</el-button>
          </template>
        </el-input>
      </el-form-item>

      <el-form-item :label="$t('projectFlow.node.priority')">
        <el-select v-model="form.priority" @change="onPriorityChange">
          <el-option v-for="p in PRIORITY_OPTIONS" :key="p.value" :label="p.label" :value="p.value"/>
        </el-select>
      </el-form-item>

      <el-form-item :label="$t('projectFlow.node.description')">
        <el-input
            v-model="form.description"
            :rows="3"
            type="textarea"
            @blur="onDescriptionBlur"
        />
      </el-form-item>
    </el-form>

    <EmployeeSelectDialog v-model="empDialogVisible" @select="onAssigneePicked"/>

    <!-- 掛在此節點的匯報項目 -->
    <section class="ins-section">
      <header class="sec-head">
        <span>📌 {{ $t('projectFlow.node.linkedReports') }}</span>
        <el-tag effect="plain" size="small" type="info">{{ linkedItems.length }}</el-tag>
        <el-button :icon="Refresh" :loading="loadingLinked" link size="small" @click="loadLinkedItems"/>
      </header>
      <el-empty v-if="!loadingLinked && !linkedItems.length" :description="$t('projectFlow.node.linkedEmpty')"
                :image-size="48"/>
      <ul v-else class="linked-list">
        <li
            v-for="item in linkedItems"
            :key="item.itemId"
            :class="`type-${item.itemType}`"
            class="linked-item"
            @click="onLinkedItemClick(item)"
        >
          <div class="linked-head">
            <el-tag :type="typeTagType(item.itemType)" size="small">{{ item.itemType }}</el-tag>
            <span class="linked-user">{{ item.reportUserId }}</span>
            <el-tag v-if="item.needHelp" size="small" type="danger">{{ $t('projectFlow.node.needHelpTag') }}</el-tag>
            <span class="linked-time">{{ formatTime(item.submittedAt ?? item.createdAt) }}</span>
          </div>
          <div class="linked-content">{{ item.content }}</div>
          <div class="linked-foot">{{ item.reportTitle }}</div>
        </li>
      </ul>
    </section>

    <div v-if="!readonly" class="ins-footer">
      <el-button :icon="Delete" plain type="danger" @click="$emit('delete')">{{
          $t('projectFlow.node.deleteNode')
        }}
      </el-button>
    </div>
  </aside>
</template>

<script lang="ts" setup>
import {ref, watch} from 'vue'
import {useRouter} from 'vue-router'
import {useI18n} from 'vue-i18n'
import {Close, Delete, Refresh} from '@element-plus/icons-vue'
import {ElMessage} from 'element-plus'
import {projectFlowApi} from '../api'
import EmployeeSelectDialog from './EmployeeSelectDialog.vue'
import type {EmployeeItem, NodeLinkedReportItem, NodeResponse} from '../types'
import {formatShortTime as formatTime} from '@/shared/utils/format'

const {t} = useI18n()

const props = defineProps<{
  node: NodeResponse | null
  /** viewer 角色 = true:表單禁用、刪除鈕隱藏(關聯匯報仍可看可跳轉) */
  readonly?: boolean
}>()

const emit = defineEmits<{
  close: []
  delete: []
  /** title / status / description / assigneeUserId 等欄位變更時通知父,讓 graph 同步 label */
  update: [patch: Partial<NodeResponse>]
}>()

const router = useRouter()

// 表單 local state,blur / change 時才 commit
const form = ref<{
  title: string
  description: string
  status: string
  assigneeUserId: string
  deadline: Date | null
  priority: number
}>({title: '', description: '', status: 'not_started', assigneeUserId: '', deadline: null, priority: 0})

const empDialogVisible = ref(false)

// ── 關聯匯報 state(必須宣告在 watch 之前 — immediate watch 在 setup 期立即執行,
//    若 ref 宣告在 watch 之後會踩 TDZ「Cannot access before initialization」)──
const linkedItems = ref<NodeLinkedReportItem[]>([])
const loadingLinked = ref(false)

async function loadLinkedItems() {
  if (!props.node) return
  loadingLinked.value = true
  try {
    linkedItems.value = await projectFlowApi.listNodeReportItems(props.node.nodeId)
  } catch (err) {
    ElMessage.error((err as Error).message)
    linkedItems.value = []
  } finally {
    loadingLinked.value = false
  }
}

// 節點切換時 reset 表單 + 載入關聯匯報
watch(
    () => props.node?.nodeId,
    () => {
      if (!props.node) return
      form.value = {
        title: props.node.title ?? '',
        description: props.node.description ?? '',
        status: props.node.status ?? 'not_started',
        assigneeUserId: props.node.assigneeUserId ?? '',
        deadline: props.node.deadline ? new Date(props.node.deadline) : null,
        priority: props.node.priority ?? 0,
      }
      void loadLinkedItems()
    },
    {immediate: true},
)

// label 走 i18n(projectFlow.nodeStatus.*),英文介面才不會破
const STATUS_OPTIONS = [
  {value: 'not_started', label: t('projectFlow.nodeStatus.not_started'), color: '#909399'},
  {value: 'in_progress', label: t('projectFlow.nodeStatus.in_progress'), color: '#409EFF'},
  {value: 'blocked', label: t('projectFlow.nodeStatus.blocked'), color: '#F56C6C'},
  {value: 'completed', label: t('projectFlow.nodeStatus.completed'), color: '#67C23A'},
  {value: 'cancelled', label: t('projectFlow.nodeStatus.cancelled'), color: '#C0C4CC'},
]

/**
 * 寫後端 + 通知父刷新。
 * patch 預設等於 payload;欄位名不一致時分開傳(如後端收 deadlineMs,父元件要 deadline)。
 */
async function commitField(payload: object, patch: Partial<NodeResponse> = payload as Partial<NodeResponse>) {
  if (!props.node) return
  try {
    await projectFlowApi.updateNode(props.node.nodeId, payload)
    emit('update', patch)
  } catch (err) {
    ElMessage.error((err as Error).message)
  }
}

function onTitleBlur() {
  if (props.node && form.value.title && form.value.title !== props.node.title) {
    commitField({title: form.value.title})
  }
}

function onDescriptionBlur() {
  if (props.node && form.value.description !== (props.node.description ?? '')) {
    commitField({description: form.value.description})
  }
}

const PRIORITY_OPTIONS = [
  {value: 0, label: t('projectFlow.memos.priorityLevel.0')},
  {value: 1, label: t('projectFlow.memos.priorityLevel.1')},
  {value: 2, label: t('projectFlow.memos.priorityLevel.2')},
]

/** 員工彈窗選中 → 直接 commit(empNo 即系統 userId) */
function onAssigneePicked(emp: EmployeeItem) {
  form.value.assigneeUserId = emp.empNo
  commitField({assigneeUserId: emp.empNo})
}

function onDeadlineChange(d: Date | null) {
  // 後端更新欄位是 deadlineMs(unix ms);清空傳 null
  void commitField({deadlineMs: d ? d.getTime() : null}, {deadline: d ? d.getTime() : undefined})
}

function onPriorityChange(p: number) {
  commitField({priority: p})
}

async function onStatusChange(newStatus: string) {
  if (!props.node) return
  try {
    // 狀態變更走專屬端點(會寫 NodeProgress 時間線),不是普通 update
    await projectFlowApi.patchNodeStatus(props.node.nodeId, {status: newStatus})
    emit('update', {status: newStatus as NodeResponse['status']})
  } catch (err) {
    ElMessage.error((err as Error).message)
    // 回滾本地狀態
    form.value.status = props.node.status
  }
}

// ─── 關聯匯報 helpers ────────────────────────────────────

function typeTagType(t: string): 'success' | 'warning' | 'danger' | 'info' {
  if (t === 'work') return 'success'
  if (t === 'issue') return 'danger'
  if (t === 'plan') return 'info'
  return 'info'
}

/** 點關聯匯報 → 直接跳該匯報編輯頁(子元件自帶 router,鬆耦合) */
function onLinkedItemClick(item: NodeLinkedReportItem) {
  router.push({name: 'report-editor', params: {reportId: String(item.reportId)}}).catch(() => {
    /* 失敗不擴散 */
  })
}
</script>

<style scoped>
.inspector {
  width: 320px;
  border-left: 1px solid #e4e7ed;
  background: #fff;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.ins-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid #f0f0f0;
}

.ins-title {
  font-weight: 600;
  color: #303133;
}

.ins-form {
  padding: 12px 14px;
  border-bottom: 1px solid #f0f0f0;
}

.ins-section {
  flex: 1;
  overflow-y: auto;
  padding: 12px 14px;
}

.sec-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
  font-weight: 600;
  color: #303133;
  font-size: 13px;
}

.linked-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.linked-item {
  border: 1px solid #e4e7ed;
  border-radius: 6px;
  padding: 10px;
  margin-bottom: 8px;
  cursor: pointer;
  transition: box-shadow 0.15s;
}

.linked-item:hover {
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
  border-color: #409EFF;
}

.linked-item.type-work {
  border-left: 3px solid #67C23A;
}

.linked-item.type-issue {
  border-left: 3px solid #F56C6C;
}

.linked-item.type-plan {
  border-left: 3px solid #909399;
}

.linked-head {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
  font-size: 12px;
}

.linked-user {
  color: #606266;
  font-weight: 600;
}

.linked-time {
  margin-left: auto;
  color: #909399;
}

.linked-content {
  font-size: 13px;
  color: #303133;
  line-height: 1.4;
  margin-bottom: 4px;
}

.linked-foot {
  font-size: 12px;
  color: #909399;
}

.ins-footer {
  padding: 12px 14px;
  border-top: 1px solid #f0f0f0;
}
</style>
