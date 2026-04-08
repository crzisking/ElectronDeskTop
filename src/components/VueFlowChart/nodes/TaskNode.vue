<script setup lang="ts">
/**
 * TaskNode — 任務節點（藍色主題）
 *
 * 項目流程中最常用的節點，代表一個具體的任務/工作項。
 * 顯示內容：標題、工號、姓名、部門代碼。
 *
 * 此流程圖用於靜態業務流程留存，不含動態狀態欄位。
 * 雙擊節點可開啟編輯對話框維護節點資訊。
 */
import { Handle, Position } from '@vue-flow/core'
import type { FlowNodeData } from '@/types/api.types'

/** Vue Flow 傳入的 node props */
defineProps<{
  id: string
  data: FlowNodeData
  selected: boolean
}>()
</script>

<template>
  <div
    class="flow-node task-node"
    :class="{ 'is-selected': selected }"
  >
    <!-- 上方連接點（輸入） -->
    <Handle type="target" :position="Position.Top" />

    <!-- 節點頭部：類型標籤 -->
    <div class="node-header">
      <span class="node-type-badge task-badge">任務</span>
    </div>

    <!-- 節點標題 -->
    <div class="node-title">{{ data.label }}</div>

    <!-- 節點信息：工號、姓名、部門代碼 -->
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

    <!-- 描述 -->
    <div v-if="data.description" class="node-desc">
      {{ data.description }}
    </div>

    <!-- 下方連接點（輸出） -->
    <Handle type="source" :position="Position.Bottom" />
  </div>
</template>

<style scoped>
/* ── 通用節點基礎樣式 ──────────────────────────────────── */
.flow-node {
  padding: 12px 16px;
  border-radius: 8px;
  min-width: 180px;
  max-width: 240px;
  font-size: 12px;
  cursor: grab;
  transition: box-shadow 0.2s, border-color 0.2s;
}

.flow-node.is-selected {
  box-shadow: 0 0 0 2px #409eff;
}

/* ── 任務節點配色 ──────────────────────────────────────── */
.task-node {
  background: #ecf5ff;
  border: 1px solid #b3d8ff;
}

.task-badge {
  background: #409eff;
  color: #fff;
}

/* ── 節點頭部 ──────────────────────────────────────────── */
.node-header {
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 6px;
}

.node-type-badge {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 4px;
  font-weight: 600;
}

/* ── 節點標題 ──────────────────────────────────────────── */
.node-title {
  font-size: 13px;
  font-weight: 600;
  color: #303133;
  margin-bottom: 6px;
  line-height: 1.3;
  text-align: center;
}

/* ── 節點元信息 ────────────────────────────────────────── */
.node-meta {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.meta-item {
  font-size: 11px;
  color: #606266;
}

/* ── 描述 ──────────────────────────────────────────────── */
.node-desc {
  font-size: 10px;
  color: #909399;
  margin-top: 4px;
  line-height: 1.4;
  border-top: 1px dashed #d9ecff;
  padding-top: 4px;
}
</style>
