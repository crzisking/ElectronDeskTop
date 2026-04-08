<script setup lang="ts">
/**
 * ApprovalNode — 審批節點（橙色主題）
 *
 * 代表項目流程中需要上級或指定人員審批的環節。
 * 顯示內容：標題、工號、姓名、部門代碼。
 *
 * 此流程圖用於靜態業務流程留存，不含動態狀態欄位。
 */
import { Handle, Position } from '@vue-flow/core'
import type { FlowNodeData } from '@/types/api.types'

defineProps<{
  id: string
  data: FlowNodeData
  selected: boolean
}>()
</script>

<template>
  <div class="flow-node approval-node" :class="{ 'is-selected': selected }">
    <Handle type="target" :position="Position.Top" />

    <div class="node-header">
      <span class="node-type-badge approval-badge">審批</span>
    </div>

    <div class="node-title">{{ data.label }}</div>

    <div class="node-meta">
      <span v-if="data.employeeId" class="meta-item">
        工號：{{ data.employeeId }}
      </span>
      <span v-if="data.employeeName" class="meta-item">
        姓名：{{ data.employeeName }}
      </span>
      <span v-if="data.departmentCode" class="meta-item">
        部門：{{ data.departmentCode }}
      </span>
    </div>

    <div v-if="data.description" class="node-desc">
      {{ data.description }}
    </div>

    <Handle type="source" :position="Position.Bottom" />
  </div>
</template>

<style scoped>
.flow-node {
  padding: 12px 16px;
  border-radius: 8px;
  min-width: 180px;
  max-width: 240px;
  font-size: 12px;
  cursor: grab;
  transition: box-shadow 0.2s;
}
.flow-node.is-selected { box-shadow: 0 0 0 2px #e6a23c; }

.approval-node {
  background: #fdf6ec;
  border: 1px solid #f5dab1;
}
.approval-badge { background: #e6a23c; color: #fff; }

.node-header { display: flex; align-items: center; justify-content: center; margin-bottom: 6px; }
.node-type-badge { font-size: 10px; padding: 1px 6px; border-radius: 4px; font-weight: 600; }
.node-title { font-size: 13px; font-weight: 600; color: #303133; margin-bottom: 6px; text-align: center; }
.node-meta { display: flex; flex-direction: column; gap: 3px; }
.meta-item { font-size: 11px; color: #606266; }
.node-desc {
  font-size: 10px;
  color: #909399;
  margin-top: 4px;
  line-height: 1.4;
  border-top: 1px dashed #f5dab1;
  padding-top: 4px;
}
</style>
