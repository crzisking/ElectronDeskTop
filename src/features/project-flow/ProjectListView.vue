<!--
  項目列表頁(docs/20 §5.1)。

  顯示當前用戶可見的所有項目(後端用 EditLevel 過濾):
   - 顯示名 / 編輯權限級別 / 節點數 / 最後更新
   - 點擊跳轉到 ProjectCanvasView 編輯
   - 右上「+ 新建項目」開 dialog
   - 不做分頁(預期每用戶可見項目 < 100,store 一次 listProjects 50 筆夠用)

  EditLevel 對應(docs/20):
    0 = 不可見(不會出現在列表)
    1 = 唯讀  2 = 可編輯內容  3 = 完全控制(含刪除 + 結構)
-->
<template>
  <div class="project-list-view">
    <header class="header">
      <el-button size="small" @click="goBack">← {{ $t('common.back') }}</el-button>
      <h2>{{ $t('projectFlow.projects.title') }}</h2>
      <el-button type="primary" @click="openCreateDialog">
        {{ $t('projectFlow.projects.create') }}
      </el-button>
    </header>

    <el-table v-loading="store.loading" :data="store.projects" stripe>
      <el-table-column :label="$t('projectFlow.projects.name')" prop="name"/>
      <el-table-column :label="$t('projectFlow.projects.description')" prop="description" show-overflow-tooltip/>
      <el-table-column :label="$t('projectFlow.projects.nodeCount')" prop="nodeCount" width="100"/>
      <el-table-column :label="$t('projectFlow.projects.progress')" width="120">
        <template #default="{row}">
          <el-progress :percentage="row.progressPercent ?? 0" :stroke-width="8"/>
        </template>
      </el-table-column>
      <el-table-column :label="$t('projectFlow.projects.updatedAt')" width="180">
        <template #default="{row}">{{ formatTime(row.updatedAt) }}</template>
      </el-table-column>
      <el-table-column :label="$t('common.actions')" width="200">
        <template #default="{row}">
          <el-button size="small" @click="openCanvas(row.projectId)">
            {{ $t('projectFlow.projects.open') }}
          </el-button>
          <!-- 刪除權限由後端 [Authorize] + EditLevel 檢查兜底;UI 不再預判 -->
          <el-button size="small" type="danger" @click="confirmDelete(row)">
            {{ $t('common.delete') }}
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <!-- 新建項目 dialog -->
    <el-dialog v-model="dialogVisible" :title="$t('projectFlow.projects.create')" width="480px">
      <el-form :model="form" label-width="80px">
        <el-form-item :label="$t('projectFlow.projects.name')" required>
          <el-input v-model="form.name"/>
        </el-form-item>
        <el-form-item :label="$t('projectFlow.projects.description')">
          <el-input v-model="form.description" :rows="3" type="textarea"/>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">{{ $t('common.cancel') }}</el-button>
        <el-button :loading="submitting" type="primary" @click="onSubmit">{{ $t('common.confirm') }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script lang="ts" setup>
import {onMounted, ref} from 'vue'
import {useRouter} from 'vue-router'
import {ElMessage, ElMessageBox} from 'element-plus'
import {useI18n} from 'vue-i18n'
import {useProjectFlowStore} from './store'
import {projectFlowApi} from './api'
import type {ProjectListItem} from './types'
import {formatDateTime as formatTime} from '@/shared/utils/format'

const router = useRouter()
const store = useProjectFlowStore()
const {t} = useI18n()

const dialogVisible = ref(false)
const submitting = ref(false)
const form = ref({name: '', description: ''})

onMounted(() => {
  store.loadProjects()
})

/** 返回 = 回上一級(個人功能)。不走 history.back — 那會跳去使用者上次逛的任意頁 */
function goBack() {
  router.push({name: 'personal-functions'})
}

function openCreateDialog() {
  form.value = {name: '', description: ''}
  dialogVisible.value = true
}

async function onSubmit() {
  if (!form.value.name.trim()) {
    ElMessage.warning(t('projectFlow.projects.nameRequired'))
    return
  }
  submitting.value = true
  try {
    await projectFlowApi.createProject({
      name: form.value.name.trim(),
      description: form.value.description.trim(),
    })
    dialogVisible.value = false
    await store.loadProjects()
    ElMessage.success(t('common.createSuccess'))
  } catch (err) {
    ElMessage.error((err as Error).message)
  } finally {
    submitting.value = false
  }
}

function openCanvas(projectId: number) {
  router.push({name: 'project-canvas', params: {projectId: String(projectId)}})
}

async function confirmDelete(row: ProjectListItem) {
  try {
    await ElMessageBox.confirm(
        t('projectFlow.projects.deleteConfirm', {name: row.name}),
        t('common.warning'),
        {type: 'warning'}
    )
    await projectFlowApi.deleteProject(row.projectId)
    await store.loadProjects()
    ElMessage.success(t('common.deleteSuccess'))
  } catch (err) {
    if (err === 'cancel') return
    ElMessage.error((err as Error).message ?? String(err))
  }
}
</script>

<style scoped>
.project-list-view {
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
</style>
