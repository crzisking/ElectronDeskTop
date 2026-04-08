<script setup lang="ts">
/**
 * EndNode — 結束節點（紅色主題）
 *
 * 流程的終點，可以有多個（代表不同的結束路徑）。
 * 僅有頂部輸入連接點（不輸出）。
 * 結束節點通常不需要填寫負責人資訊，但保留描述欄位。
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
  <div class="flow-node end-node" :class="{ 'is-selected': selected }">
    <!-- 結束節點只有輸入（頂部） -->
    <Handle type="target" :position="Position.Top" />

    <div class="node-header">
      <span class="node-type-badge end-badge">結束</span>
    </div>
    <div class="node-title">{{ data.label }}</div>

    <div v-if="data.description" class="node-desc">
      {{ data.description }}
    </div>
  </div>
</template>

<style scoped>
.flow-node {
  padding: 12px 16px;
  border-radius: 20px;
  min-width: 140px;
  text-align: center;
  font-size: 12px;
  cursor: grab;
  transition: box-shadow 0.2s;
}
.flow-node.is-selected { box-shadow: 0 0 0 2px #f56c6c; }

.end-node { background: #fef0f0; border: 1px solid #fbc4c4; }
.end-badge { background: #f56c6c; color: #fff; }

.node-header { display: flex; justify-content: center; margin-bottom: 6px; }
.node-type-badge { font-size: 10px; padding: 1px 6px; border-radius: 4px; font-weight: 600; }
.node-title { font-size: 13px; font-weight: 600; color: #303133; }
.node-desc {
  font-size: 10px;
  color: #909399;
  margin-top: 4px;
  line-height: 1.4;
}
</style>
