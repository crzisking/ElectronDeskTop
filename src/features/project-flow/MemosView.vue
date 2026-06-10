<!--
  備忘錄(docs/20 §5.5)— 在獨立彈窗(MemosWindow)和主窗都能用。

  Schema 對齊後端 MemoResponse:
    title / description / dueDate(unix ms)/ priority(0=low/1=med/2=high)/
    status('pending'|'done'|'dismissed')/ source('manual'|'ai-suggestion')
  ⚠️ 建立/更新「請求」的欄位名是 dueDateMs(「回應」才叫 dueDate),兩邊不要搞混。

  AI 建議:
    輸入 = 我的項目節點(快到期/逾期/阻塞)+ 現有 pending 備忘(避免重複建議)
    輸出 = 建議清單進「採納彈窗」,使用者勾選要的才入庫 — 不自動全建
-->
<template>
  <div class="memos-view">
    <header class="header">
      <h2>{{ $t('projectFlow.memos.title') }}</h2>
      <div class="actions">
        <el-button :loading="aiLoading" @click="onAiSuggest">{{ $t('projectFlow.memos.aiSuggest') }}</el-button>
        <el-button type="primary" @click="openCreate">+ {{ $t('projectFlow.memos.create') }}</el-button>
      </div>
    </header>

    <el-table v-loading="store.loading" :data="store.memos" stripe>
      <el-table-column :label="$t('projectFlow.memos.titleCol')" prop="title"/>
      <el-table-column :label="$t('projectFlow.memos.description')" prop="description" show-overflow-tooltip/>
      <el-table-column :label="$t('projectFlow.memos.priority')" width="100">
        <template #default="{row}">
          <el-tag :type="priorityTagType(row.priority)" size="small">
            {{ $t(`projectFlow.memos.priorityLevel.${row.priority}`) }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column :label="$t('common.status')" width="140">
        <template #default="{row}">
          <el-select v-model="row.status" size="small" @change="onStatusChange(row)">
            <el-option v-for="s in STATUSES" :key="s" :label="$t(`projectFlow.memos.status.${s}`)" :value="s"/>
          </el-select>
        </template>
      </el-table-column>
      <el-table-column :label="$t('projectFlow.memos.dueDate')" width="160">
        <template #default="{row}">{{ formatTime(row.dueDate) }}</template>
      </el-table-column>
      <el-table-column :label="$t('common.actions')" width="120">
        <template #default="{row}">
          <el-button link size="small" type="danger" @click="onDelete(row.memoId)">{{ $t('common.delete') }}</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="dialogVisible" :title="$t('projectFlow.memos.create')" width="480px">
      <el-form :model="form" label-width="80px">
        <el-form-item :label="$t('projectFlow.memos.titleCol')" required>
          <el-input v-model="form.title"/>
        </el-form-item>
        <el-form-item :label="$t('projectFlow.memos.description')">
          <el-input v-model="form.description" :rows="3" type="textarea"/>
        </el-form-item>
        <el-form-item :label="$t('projectFlow.memos.priority')">
          <!-- EP 2.4 的 el-radio-button 用 :label 綁定值(2.6+ 才有 :value 別名) -->
          <el-radio-group v-model="form.priority">
            <el-radio-button :label="0">{{ $t('projectFlow.memos.priorityLevel.0') }}</el-radio-button>
            <el-radio-button :label="1">{{ $t('projectFlow.memos.priorityLevel.1') }}</el-radio-button>
            <el-radio-button :label="2">{{ $t('projectFlow.memos.priorityLevel.2') }}</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item :label="$t('projectFlow.memos.dueDate')">
          <el-date-picker v-model="form.dueDate" type="datetime" value-format="x"/>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">{{ $t('common.cancel') }}</el-button>
        <el-button :loading="submitting" type="primary" @click="onSubmit">{{ $t('common.confirm') }}</el-button>
      </template>
    </el-dialog>

    <!-- AI 建議採納彈窗:勾選要的才入庫,reasoning 說明為什麼建議 -->
    <el-dialog v-model="suggestDialogVisible" :title="$t('projectFlow.memos.aiSuggest')" width="560px">
      <div v-for="(s, i) in suggestions" :key="i" class="sug-item">
        <el-checkbox v-model="s.checked">
          <span class="sug-title">{{ s.title }}</span>
          <el-tag :type="priorityTagType(s.priority ?? 1)" size="small">
            {{ $t(`projectFlow.memos.priorityLevel.${s.priority ?? 1}`) }}
          </el-tag>
        </el-checkbox>
        <div v-if="s.description" class="sug-desc">{{ s.description }}</div>
        <div v-if="s.reasoning" class="sug-reason">💡 {{ s.reasoning }}</div>
      </div>
      <template #footer>
        <el-button @click="suggestDialogVisible = false">{{ $t('common.cancel') }}</el-button>
        <el-button :loading="accepting" type="primary" @click="onAcceptSuggestions">
          {{ $t('projectFlow.memos.acceptChecked') }}
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script lang="ts" setup>
import {onMounted, ref} from 'vue'
import {ElMessage, ElMessageBox} from 'element-plus'
import {useI18n} from 'vue-i18n'
import {useProjectFlowStore} from './store'
import {projectFlowApi} from './api'
import type {MemoResponse, MyNodeItem} from './types'

const store = useProjectFlowStore()
const {t} = useI18n()

const STATUSES = ['pending', 'done', 'dismissed'] as const

const dialogVisible = ref(false)
const submitting = ref(false)
const aiLoading = ref(false)
const form = ref<{ title: string; description: string; priority: number; dueDate: number | null }>({
  title: '', description: '', priority: 1, dueDate: null,
})

onMounted(() => store.loadMemos())

function openCreate() {
  form.value = {title: '', description: '', priority: 1, dueDate: null}
  dialogVisible.value = true
}

async function onSubmit() {
  if (!form.value.title.trim()) {
    ElMessage.warning(t('projectFlow.memos.titleRequired'))
    return
  }
  submitting.value = true
  try {
    await projectFlowApi.createMemo({
      title: form.value.title.trim(),
      description: form.value.description.trim() || null,
      priority: form.value.priority,
      // el-date-picker value-format="x" 回字串,後端要 number
      dueDateMs: form.value.dueDate ? Number(form.value.dueDate) : null,
    })
    dialogVisible.value = false
    await store.loadMemos()
  } catch (err) {
    ElMessage.error((err as Error).message)
  } finally {
    submitting.value = false
  }
}

async function onStatusChange(row: MemoResponse) {
  try {
    await projectFlowApi.setMemoStatus(row.memoId, {status: row.status})
  } catch (err) {
    ElMessage.error((err as Error).message)
    store.loadMemos()
  }
}

async function onDelete(id: number) {
  try {
    await ElMessageBox.confirm(t('projectFlow.memos.deleteConfirm'), t('common.warning'), {type: 'warning'})
    await projectFlowApi.deleteMemo(id)
    await store.loadMemos()
  } catch (err) {
    if (err === 'cancel') return
    ElMessage.error((err as Error).message ?? String(err))
  }
}

// ─── AI 建議:項目進度 + 現有待辦驅動 ────────────────────────

interface Suggestion {
  title: string
  description?: string
  priority?: number
  reasoning?: string
  /** 採納彈窗的勾選狀態 */
  checked?: boolean
}

const suggestions = ref<Suggestion[]>([])
const suggestDialogVisible = ref(false)
const accepting = ref(false)

/**
 * 收集上下文 → 本地 LLM 生成建議 → 開採納彈窗。
 * 上下文:我名下未完成的節點(看截止日/阻塞)+ 現有 pending 備忘(讓 AI 不重複建議)。
 */
async function onAiSuggest() {
  aiLoading.value = true
  try {
    const myNodes = ((await projectFlowApi.listMyNodes()) as MyNodeItem[]) ?? []
    const pendingMemos = store.memos.filter((m) => m.status === 'pending')

    const r = (await projectFlowApi.aiMemoSuggest({
      nodes: myNodes
          .filter((n) => n.status !== 'completed' && n.status !== 'cancelled')
          .map((n) => ({
            projectName: n.projectName,
            title: n.title,
            status: n.status,
            deadline: n.deadline,
            priority: n.priority
          })),
      memos: pendingMemos.map((m) => ({title: m.title, priority: m.priority, dueDate: m.dueDate})),
    })) as { suggestions?: Suggestion[] }

    const list = r?.suggestions ?? []
    if (!list.length) {
      ElMessage.info(t('projectFlow.memos.aiEmpty'))
      return
    }
    suggestions.value = list.map((s) => ({...s, checked: true}))
    suggestDialogVisible.value = true
  } catch (err) {
    ElMessage.error((err as Error).message)
  } finally {
    aiLoading.value = false
  }
}

/** 採納勾選的建議 → 逐條入庫(source 標 ai-suggestion,reasoning 存 aiReasoning 供回溯) */
async function onAcceptSuggestions() {
  const chosen = suggestions.value.filter((s) => s.checked)
  if (!chosen.length) {
    suggestDialogVisible.value = false
    return
  }
  accepting.value = true
  try {
    for (const s of chosen) {
      await projectFlowApi.createMemo({
        title: s.title,
        description: s.description ?? null,
        priority: s.priority ?? 1,
        source: 'ai-suggestion',
        aiReasoning: s.reasoning ?? null,
      })
    }
    suggestDialogVisible.value = false
    await store.loadMemos()
    ElMessage.success(t('projectFlow.memos.aiAdded', {n: chosen.length}))
  } catch (err) {
    ElMessage.error((err as Error).message)
  } finally {
    accepting.value = false
  }
}

function priorityTagType(p: number) {
  return p >= 2 ? 'danger' : p === 1 ? 'warning' : 'info'
}

function formatTime(ms: number | null | undefined): string {
  return ms ? new Date(ms).toLocaleString() : '-'
}
</script>

<style scoped>
.memos-view {
  padding: 16px;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.actions {
  display: flex;
  gap: 8px;
}

.sug-item {
  padding: 10px 0;
  border-bottom: 1px dashed #f0f0f0;
}

.sug-title {
  font-weight: 600;
  margin-right: 8px;
}

.sug-desc {
  margin: 4px 0 0 24px;
  font-size: 13px;
  color: #303133;
}

.sug-reason {
  margin: 4px 0 0 24px;
  font-size: 12px;
  color: #909399;
}
</style>
