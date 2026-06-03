<script lang="ts" setup>
/**
 * 日誌表格 — el-table + 展開行 + 點模組名快速過濾。
 *
 * 純展示 + 一個 picked-module 事件給父層快捷過濾用。
 * 行高亮(error 紅 / warn 黃)走 global style 避免 scoped 蓋不到 el-table 內部。
 */
import type {LogLevel, LogRow} from '../types'

defineProps<{
  rows: LogRow[]
  loading: boolean
  /** Unix ms 格式化(父層注入) */
  formatTime: (ms: number) => string
  /** JSON 字串美化(父層注入,展開時顯示 args 用) */
  prettyJson: (s: string | null) => string
}>()

const emit = defineEmits<{
  /** 點擊模組名 → 父層自動填到過濾下拉並立即查詢 */
  (e: 'pick-module', m: string): void
}>()

function levelTagType(level: LogLevel): 'info' | 'success' | 'warning' | 'danger' {
  switch (level) {
    case 'error':
      return 'danger'
    case 'warn':
      return 'warning'
    case 'info':
      return 'success'
    case 'debug':
      return 'info'
  }
}

function rowClassName({row}: { row: LogRow }): string {
  if (row.level === 'error') return 'row-error'
  if (row.level === 'warn') return 'row-warn'
  return ''
}
</script>

<template>
  <el-table
      v-loading="loading"
      :data="rows"
      :row-class-name="rowClassName"
      class="log-table"
      height="100%"
      stripe
  >
    <!-- 展開行:顯示 args / errorStack 全文 -->
    <el-table-column type="expand">
      <template #default="{row}">
        <div class="expand-panel">
          <div v-if="row.args" class="expand-block">
            <div class="expand-label">args</div>
            <pre class="expand-pre">{{ prettyJson(row.args) }}</pre>
          </div>
          <div v-if="row.errorStack" class="expand-block">
            <div class="expand-label">errorStack</div>
            <pre class="expand-pre">{{ row.errorStack }}</pre>
          </div>
          <div v-if="!row.args && !row.errorStack" class="expand-empty">
            此筆無 args / errorStack
          </div>
        </div>
      </template>
    </el-table-column>

    <el-table-column label="時間" prop="createdAt" width="200">
      <template #default="{row}">
        <span class="mono">{{ formatTime(row.createdAt) }}</span>
      </template>
    </el-table-column>

    <el-table-column label="等級" prop="level" width="80">
      <template #default="{row}">
        <el-tag :type="levelTagType(row.level)" disable-transitions size="small">
          {{ row.level.toUpperCase() }}
        </el-tag>
      </template>
    </el-table-column>

    <el-table-column label="來源" prop="source" width="100"/>

    <el-table-column label="模組" prop="module" width="160">
      <template #default="{row}">
        <span
            v-if="row.module"
            :title="`篩選此模組:${row.module}`"
            class="mono small module-cell"
            @click="emit('pick-module', row.module)"
        >{{ row.module }}</span>
        <span v-else class="placeholder">—</span>
      </template>
    </el-table-column>

    <el-table-column label="訊息" min-width="320" prop="message" show-overflow-tooltip/>
  </el-table>
</template>

<style scoped>
.log-table {
  flex: 1;
  min-height: 0;
}

.mono {
  font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
  font-variant-numeric: tabular-nums;
  font-size: 12px;
}

.mono.small {
  font-size: 11.5px;
  color: #4b5563;
}

/* 模組單元格:hover 出底色 + 變藍提示可點 */
.module-cell {
  cursor: pointer;
  padding: 1px 4px;
  border-radius: 3px;
  transition: background 0.12s, color 0.12s;
}

.module-cell:hover {
  background: #e0e7ff;
  color: #3730a3;
}

.placeholder {
  color: #9ca3af;
}

.expand-panel {
  padding: 8px 16px 16px 48px;
  background: #f9fafb;
}

.expand-block {
  margin-top: 8px;
}

.expand-label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #6b7280;
  margin-bottom: 4px;
}

.expand-pre {
  margin: 0;
  padding: 8px 12px;
  background: #ffffff;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 320px;
  overflow: auto;
}

.expand-empty {
  color: #9ca3af;
  font-size: 12px;
  margin-top: 4px;
}
</style>

<!-- 全局樣式:行高亮(scoped 蓋不到 el-table 內部) -->
<style>
.el-table .row-error {
  --el-table-tr-bg-color: #fef2f2;
}

.el-table .row-error:hover > td {
  background-color: #fee2e2 !important;
}

.el-table .row-warn {
  --el-table-tr-bg-color: #fffbeb;
}

.el-table .row-warn:hover > td {
  background-color: #fef3c7 !important;
}
</style>
