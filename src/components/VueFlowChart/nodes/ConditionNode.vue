<script setup lang="ts">
/**
 * ConditionNode — 條件分支節點（紫色主題）
 *
 * 流程中的判斷/分支點，根據條件走不同的路徑。
 * 例如：「金額 > 10萬？」→ 是：走高層審批 / 否：走主管審批
 * 有頂部輸入和底部/右側輸出連接點。
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
  <div class="flow-node condition-node" :class="{ 'is-selected': selected }">
    <Handle type="target" :position="Position.Top" />

    <div class="node-header">
      <span class="node-type-badge condition-badge">條件</span>
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

    <!-- 條件節點左右也可以輸出（代表不同分支） -->
    <Handle id="bottom" type="source" :position="Position.Bottom" />
    <Handle id="right" type="source" :position="Position.Right" />
  </div>
</template>

<style scoped>
.flow-node {
  padding: 12px 16px;
  border-radius: 8px;
  min-width: 160px;
  max-width: 220px;
  font-size: 12px;
  cursor: grab;
  transition: box-shadow 0.2s;
}
.flow-node.is-selected { box-shadow: 0 0 0 2px #a855f7; }

.condition-node {
  background: #faf5ff;
  border: 2px dashed #c084fc;
}
.condition-badge { background: #a855f7; color: #fff; }

.node-header { display: flex; justify-content: center; margin-bottom: 6px; }
.node-type-badge { font-size: 10px; padding: 1px 6px; border-radius: 4px; font-weight: 600; }
.node-title { font-size: 13px; font-weight: 600; color: #303133; margin-bottom: 4px; text-align: center; }
.node-meta { display: flex; flex-direction: column; gap: 3px; }
.meta-item { font-size: 11px; color: #606266; }
.node-desc {
  font-size: 10px;
  color: #909399;
  margin-top: 4px;
  line-height: 1.4;
  border-top: 1px dashed #c084fc;
  padding-top: 4px;
}
</style>
