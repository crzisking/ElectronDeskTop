<!--
  員工選擇彈窗 — 複用後端 /api/employee/getEmployees(工號/姓名/電話模糊搜尋)。

  用法:
    <EmployeeSelectDialog v-model="visible" @select="(emp) => ..." />
  選中一筆即觸發 select 並關閉;按需要也可以雙擊行選取。
  任何需要「填工號」的地方都應該用這個,不要讓使用者手打。
-->
<template>
  <el-dialog
      :model-value="modelValue"
      :title="$t('projectFlow.employee.pickTitle')"
      append-to-body
      width="640px"
      @open="onOpen"
      @update:model-value="emit('update:modelValue', $event)"
  >
    <el-input
        v-model="keyword"
        :placeholder="$t('projectFlow.employee.searchPlaceholder')"
        clearable
        @keyup.enter="search(1)"
    >
      <template #append>
        <el-button :loading="loading" @click="search(1)">{{ $t('common.search') }}</el-button>
      </template>
    </el-input>

    <el-table
        v-loading="loading"
        :data="rows"
        class="emp-table"
        height="320"
        highlight-current-row
        size="small"
        @row-dblclick="pick"
    >
      <el-table-column :label="$t('projectFlow.employee.empNo')" prop="empNo" width="110"/>
      <el-table-column :label="$t('projectFlow.employee.name')" prop="name" width="120"/>
      <el-table-column :label="$t('projectFlow.employee.job')" prop="job" show-overflow-tooltip/>
      <el-table-column width="90">
        <template #default="{row}">
          <el-button link size="small" type="primary" @click="pick(row)">
            {{ $t('common.select') }}
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-pagination
        v-if="total > pageSize"
        :current-page="page"
        :page-size="pageSize"
        :total="total"
        layout="prev, pager, next"
        small
        @current-change="search"
    />
  </el-dialog>
</template>

<script lang="ts" setup>
import {ref} from 'vue'
import {ElMessage} from 'element-plus'
import {projectFlowApi} from '../api'
import type {EmployeeItem} from '../types'

defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{
  'update:modelValue': [v: boolean]
  /** 使用者選中員工(empNo 為工號 — 系統內的 userId) */
  select: [emp: EmployeeItem]
}>()

const keyword = ref('')
const rows = ref<EmployeeItem[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = 20
const loading = ref(false)

/** 開啟時自動帶出第一頁(空 keyword 後端回全部,夠用) */
function onOpen() {
  if (!rows.value.length) void search(1)
}

async function search(toPage: number) {
  page.value = toPage
  loading.value = true
  try {
    const r = (await projectFlowApi.searchEmployees({
      keyword: keyword.value.trim() || undefined,
      pageIndex: toPage,
      pageSize,
    }))
    rows.value = r?.list ?? []
    total.value = r?.total ?? 0
  } catch (err) {
    ElMessage.error((err as Error).message)
  } finally {
    loading.value = false
  }
}

function pick(row: EmployeeItem) {
  emit('select', row)
  emit('update:modelValue', false)
}
</script>

<style scoped>
.emp-table {
  margin: 12px 0;
}
</style>
