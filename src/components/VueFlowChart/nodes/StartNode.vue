<script setup lang="ts">
/**
 * StartNode — 開始節點（綠色主題）
 *
 * 流程的起點，每個流程通常只有一個。
 * 外觀為圓角矩形，僅有底部輸出連接點（不接受輸入）。
 * 開始節點通常不需要填寫負責人資訊，但保留描述欄位。
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
  <div class="flow-node start-node" :class="{ 'is-selected': selected }">
    <div class="node-header">
      <span class="node-type-badge start-badge">開始</span>
    </div>
    <div class="node-title">{{ data.label }}</div>

    <div v-if="data.description" class="node-desc">
      {{ data.description }}
    </div>

    <!-- 開始節點只有輸出（底部） -->
    <Handle type="source" :position="Position.Bottom" />
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
.flow-node.is-selected { box-shadow: 0 0 0 2px #67c23a; }

.start-node { background: #f0f9eb; border: 1px solid #c2e7b0; }
.start-badge { background: #67c23a; color: #fff; }

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
