<!--
  匯報列表(docs/20 §5.3)。

  顯示我的匯報草稿 / 已提交,支援新建。
  AI 報告生成在編輯器內(本地)觸發,不在這頁。
-->
<template>
  <div class="report-list-view">
    <header class="header">
      <el-button size="small" @click="goBack">← {{ $t('common.back') }}</el-button>
      <h2>{{ $t('projectFlow.reports.title') }}</h2>
      <el-button type="primary" @click="onCreate">{{ $t('projectFlow.reports.create') }}</el-button>
    </header>
    <el-table v-loading="loading" :data="store.reports" stripe>
      <el-table-column :label="$t('projectFlow.reports.titleCol')" prop="title"/>
      <el-table-column :label="$t('common.status')" prop="status" width="120">
        <template #default="{row}">
          <el-tag :type="row.status === 'submitted' ? 'success' : 'info'" size="small">
            {{ $t(`projectFlow.reports.status.${row.status}`) }}
          </el-tag>
        </template>
      </el-table-column>
      <!-- 後端 ListMyReportsAsync 返回 ReportSummaryItem,只有 createdAt/submittedAt;updatedAt 在這個列表沒有 -->
      <el-table-column :label="$t('projectFlow.reports.createdAt')" width="180">
        <template #default="{row}">{{ formatTime(row.submittedAt ?? row.createdAt) }}</template>
      </el-table-column>
      <el-table-column :label="$t('common.actions')" width="200">
        <template #default="{row}">
          <el-button size="small" @click="onEdit(row.reportId)">{{ $t('common.edit') }}</el-button>
          <el-button v-if="row.status === 'draft'" size="small" type="danger" @click="onDelete(row.reportId)">
            {{ $t('common.delete') }}
          </el-button>
        </template>
      </el-table-column>
    </el-table>
    <!-- 匯報日積月累,必須分頁;page state 在本 view,數據在 store -->
    <el-pagination
        v-if="store.reportsTotal > PF_PAGE_SIZE"
        :current-page="page"
        :page-size="PF_PAGE_SIZE"
        :total="store.reportsTotal"
        class="pager"
        layout="total, prev, pager, next"
        @current-change="refresh"
    />
  </div>
</template>

<script lang="ts" setup>
import {onMounted, ref} from 'vue'
import {useRouter} from 'vue-router'
import {ElMessage, ElMessageBox} from 'element-plus'
import {useI18n} from 'vue-i18n'
import {PF_PAGE_SIZE, useProjectFlowStore} from './store'
import {projectFlowApi} from './api'
import {formatDateTime as formatTime} from '@/shared/utils/format'

const router = useRouter()
const store = useProjectFlowStore()
const {t} = useI18n()
const loading = ref(false)
const page = ref(1)

onMounted(() => refresh(1))

async function refresh(toPage: number = page.value) {
  page.value = toPage
  loading.value = true
  try {
    await store.loadReports(toPage)
  } finally {
    loading.value = false
  }
}

/** 返回 = 回上一級(個人功能)。不走 history.back — 那會跳去使用者上次逛的任意頁 */
function goBack() {
  router.push({name: 'personal-functions'})
}

async function onCreate() {
  try {
    const r = await projectFlowApi.createReport({title: t('projectFlow.reports.defaultTitle')})
    router.push({name: 'report-editor', params: {reportId: String(r.reportId)}})
  } catch (err) {
    ElMessage.error((err as Error).message)
  }
}

function onEdit(id: number) {
  router.push({name: 'report-editor', params: {reportId: String(id)}})
}

async function onDelete(id: number) {
  try {
    await ElMessageBox.confirm(t('projectFlow.reports.deleteConfirm'), t('common.warning'), {type: 'warning'})
    await projectFlowApi.deleteReport(id)
    refresh()
    ElMessage.success(t('common.deleteSuccess'))
  } catch (err) {
    if (err === 'cancel') return
    ElMessage.error((err as Error).message ?? String(err))
  }
}
</script>

<style scoped>
.report-list-view {
  padding: 16px;
}

.header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}

.header h2 {
  flex: 1;
  margin: 0;
}

.pager {
  margin-top: 12px;
  justify-content: flex-end;
}
</style>
