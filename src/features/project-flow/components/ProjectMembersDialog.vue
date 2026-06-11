<!--
  項目成員管理彈窗 — 成員制權限的入口(僅 owner / 管理員可改,其他人唯讀檢視)。

  角色語義(對齊後端 ResolveRoleAsync):
    owner  = 項目建立者(第一筆,不可改不可刪)
    editor = 可編輯節點 / 連線 / 項目資訊
    viewer = 唯讀
  加成員走 EmployeeSelectDialog(不手打工號);改角色行內 select 即時生效。
-->
<template>
  <el-dialog
      :model-value="modelValue"
      :title="$t('projectFlow.members.title')"
      append-to-body
      width="560px"
      @open="load"
      @update:model-value="emit('update:modelValue', $event)"
  >
    <div v-if="canManage" class="toolbar">
      <el-button size="small" type="primary" @click="empDialogVisible = true">
        + {{ $t('projectFlow.members.add') }}
      </el-button>
    </div>

    <el-table v-loading="loading" :data="members" size="small">
      <el-table-column :label="$t('projectFlow.employee.empNo')" prop="userId" width="110"/>
      <el-table-column :label="$t('projectFlow.employee.name')" prop="name" width="110"/>
      <el-table-column :label="$t('projectFlow.members.role')">
        <template #default="{row}">
          <el-tag v-if="row.role === 'owner'" size="small" type="warning">
            {{ $t('projectFlow.members.roleOwner') }}
          </el-tag>
          <el-select
              v-else-if="canManage"
              :model-value="row.role"
              size="small"
              style="width: 110px"
              @update:model-value="(r: string) => onRoleChange(row, r)"
          >
            <el-option :label="$t('projectFlow.members.roleEditor')" value="editor"/>
            <el-option :label="$t('projectFlow.members.roleViewer')" value="viewer"/>
          </el-select>
          <el-tag v-else :type="row.role === 'editor' ? 'success' : 'info'" size="small">
            {{ $t(`projectFlow.members.role${row.role === 'editor' ? 'Editor' : 'Viewer'}`) }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column v-if="canManage" width="80">
        <template #default="{row}">
          <el-button
              v-if="row.role !== 'owner'"
              link size="small" type="danger"
              @click="onRemove(row)"
          >
            {{ $t('common.delete') }}
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <p class="hint">{{ $t('projectFlow.members.hint') }}</p>

    <EmployeeSelectDialog v-model="empDialogVisible" @select="onEmployeePicked"/>
  </el-dialog>
</template>

<script lang="ts" setup>
import {ref} from 'vue'
import {ElMessage} from 'element-plus'
import {projectFlowApi} from '../api'
import EmployeeSelectDialog from './EmployeeSelectDialog.vue'
import type {EmployeeItem, ProjectMemberItem} from '../types'

const props = defineProps<{
  modelValue: boolean
  projectId: number
  /** 是否能管理(owner / 管理員);其他角色開彈窗只能看 */
  canManage: boolean
}>()
const emit = defineEmits<{ 'update:modelValue': [v: boolean] }>()

const members = ref<ProjectMemberItem[]>([])
const loading = ref(false)
const empDialogVisible = ref(false)

async function load() {
  loading.value = true
  try {
    members.value = await projectFlowApi.listMembers(props.projectId)
  } catch (err) {
    ElMessage.error((err as Error).message)
  } finally {
    loading.value = false
  }
}

/** 新成員預設 viewer(最小權限),要編輯再升 */
async function onEmployeePicked(emp: EmployeeItem) {
  try {
    await projectFlowApi.upsertMember(props.projectId, {userId: emp.empNo, role: 'viewer'})
    await load()
  } catch (err) {
    ElMessage.error((err as Error).message)
  }
}

async function onRoleChange(row: ProjectMemberItem, role: string) {
  try {
    await projectFlowApi.upsertMember(props.projectId, {userId: row.userId, role: role as 'viewer' | 'editor'})
    row.role = role as ProjectMemberItem['role']
  } catch (err) {
    ElMessage.error((err as Error).message)
  }
}

async function onRemove(row: ProjectMemberItem) {
  try {
    await projectFlowApi.removeMember(props.projectId, row.userId)
    members.value = members.value.filter((m) => m.userId !== row.userId)
  } catch (err) {
    ElMessage.error((err as Error).message)
  }
}
</script>

<style scoped>
.toolbar {
  margin-bottom: 10px;
}

.hint {
  font-size: 12px;
  color: #909399;
  margin: 10px 0 0;
}
</style>
