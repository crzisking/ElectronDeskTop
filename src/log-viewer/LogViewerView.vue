<script setup lang="ts">
/**
 * 日誌查看器主畫面。
 *
 * 功能(MVP):
 *  - 等級多選過濾(debug/info/warn/error)
 *  - 來源過濾(main/renderer)
 *  - 訊息關鍵字搜尋
 *  - 日期區間過濾
 *  - 分頁(預設 200/頁)
 *  - 點開展開行看 args / errorStack
 *
 * 資料來源:logViewerAPI.query(...) → 主進程 LogService.query
 *           (主進程 handler 內已驗 _unlocked,本視窗不會在未解鎖時被開)
 *
 * 沒做(留給後續):清空、匯出 ZIP、自動刷新、模組下拉過濾
 */

import {onMounted, ref} from 'vue'
import {ElMessage} from 'element-plus'

// ── 型別:跟主進程 LogService 對齊;為了不跨邊界 import,在此重宣告 ──
type LogLevel = 'debug' | 'info' | 'warn' | 'error'
type LogSource = 'main' | 'renderer'

interface LogRow {
  id: number
  createdAt: number
  level: LogLevel
  source: LogSource
  module: string | null
  message: string
  args: string | null
  errorStack: string | null
}

interface QueryResult {
  rows: LogRow[]
  total: number
}

interface WorkHealth {
  pendingSync: number
  writeFailures: number
  markFailures: number
  lastError: string | null
  lastErrorAt: number | null
}

interface LogViewerAPI {
  query: (params: Record<string, unknown>) => Promise<QueryResult>
  workHealth: () => Promise<WorkHealth>
}

declare global {
  interface Window {
    logViewerAPI: LogViewerAPI
  }
}

// ── 過濾條件(響應式)──────────────────────────────────────────────
/** 等級多選,空 = 全部 */
const levelFilter = ref<LogLevel[]>([])

/** 來源,'' = 全部 */
const sourceFilter = ref<LogSource | ''>('')

/** 訊息搜尋關鍵字 */
const searchKeyword = ref('')

/** 日期區間:[起, 迄];未選 = 不限 */
const dateRange = ref<[Date, Date] | null>(null)

/** 分頁 */
const currentPage = ref(1)
const pageSize = ref(200)

// ── 資料 ──────────────────────────────────────────────────────────
const rows = ref<LogRow[]>([])
const total = ref(0)
const loading = ref(false)

// ── 採集健康狀態(只在此密碼保護窗口可見)─────────────────────────
const health = ref<WorkHealth | null>(null)

async function loadHealth() {
  try {
    health.value = await window.logViewerAPI.workHealth()
  } catch {
    health.value = null
  }
}

// ── 查詢 ──────────────────────────────────────────────────────────

/**
 * 把目前 UI 狀態組成 query params 傳給主進程。
 * limit / offset 由 currentPage * pageSize 算。
 */
async function runQuery() {
  loading.value = true
  try {
    // 注意:所有 ref 值都要「拆出純值」再放進 params。
    // 直接放 levelFilter.value 會帶 Vue 響應式 Proxy,IPC structuredClone 拒絕 → 報
    // "An object could not be cloned"。用 [...arr] 展開成純陣列,字串/數字本來就是值。
    const params: Record<string, unknown> = {
      limit: pageSize.value,
      offset: (currentPage.value - 1) * pageSize.value,
    }
    if (levelFilter.value.length > 0) params.level = [...levelFilter.value]
    if (sourceFilter.value) params.source = sourceFilter.value
    if (searchKeyword.value.trim()) params.search = searchKeyword.value.trim()
    if (dateRange.value) {
      params.since = dateRange.value[0].getTime()
      // 終點+1天-1ms,讓「2026-05-19」包含當天 23:59:59.999
      params.until = dateRange.value[1].getTime() + 24 * 60 * 60 * 1000
    }

    const result = await window.logViewerAPI.query(params)
    rows.value = result.rows
    total.value = result.total
  } catch (err) {
    ElMessage.error(`查詢失敗: ${(err as Error).message ?? err}`)
    rows.value = []
    total.value = 0
  } finally {
    loading.value = false
  }
}

/** 「查詢」按鈕:回第 1 頁 + 重查 */
function handleSearch() {
  currentPage.value = 1
  runQuery()
}

/** 重置所有過濾條件 */
function handleReset() {
  levelFilter.value = []
  sourceFilter.value = ''
  searchKeyword.value = ''
  dateRange.value = null
  currentPage.value = 1
  runQuery()
}

/** 切頁不變動其他條件,直接重查 */
function handlePageChange(page: number) {
  currentPage.value = page
  runQuery()
}

function handlePageSizeChange(size: number) {
  pageSize.value = size
  currentPage.value = 1
  runQuery()
}

// ── 格式化 ────────────────────────────────────────────────────────

/** Unix ms → '2026-05-19 14:35:22.123' */
function formatTime(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number, w = 2) => String(n).padStart(w, '0')
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.` +
    `${pad(d.getMilliseconds(), 3)}`
  )
}

/** 等級樣式映射:el-tag type */
function levelTagType(level: LogLevel): 'info' | 'success' | 'warning' | 'danger' {
  switch (level) {
    case 'error': return 'danger'
    case 'warn': return 'warning'
    case 'info': return 'success'
    case 'debug': return 'info'
  }
}

/** JSON 字串美化(用於展開時顯示 args) */
function prettyJson(jsonStr: string | null): string {
  if (!jsonStr) return ''
  try {
    return JSON.stringify(JSON.parse(jsonStr), null, 2)
  } catch {
    return jsonStr
  }
}

/** 行高亮:error 紅底,warn 黃底 */
function rowClassName({row}: {row: LogRow}): string {
  if (row.level === 'error') return 'row-error'
  if (row.level === 'warn') return 'row-warn'
  return ''
}

// ── 初始載入 ──────────────────────────────────────────────────────
onMounted(() => {
  runQuery()
  loadHealth()
})
</script>

<template>
  <div class="log-viewer">
    <!-- ── 採集健康狀態(維運用,僅此密碼保護窗口可見)──────────── -->
    <div v-if="health" class="health-bar">
      <span class="health-title">採集健康</span>
      <el-tag :type="health.pendingSync > 0 ? 'warning' : 'success'" effect="plain" size="small">
        待同步 {{ health.pendingSync }} 筆
      </el-tag>
      <el-tag v-if="health.writeFailures > 0" effect="plain" size="small" type="danger">
        寫入失敗 {{ health.writeFailures }}
      </el-tag>
      <el-tag v-if="health.markFailures > 0" effect="plain" size="small" type="danger">
        標記失敗 {{ health.markFailures }}
      </el-tag>
      <span v-if="health.lastError" class="health-error">
        最近異常 {{ health.lastErrorAt ? formatTime(health.lastErrorAt) : '' }} — {{ health.lastError }}
      </span>
      <el-button size="small" text @click="loadHealth">刷新</el-button>
    </div>

    <!-- ── 過濾條 ──────────────────────────────────────── -->
    <div class="filter-bar">
      <el-select
        v-model="levelFilter"
        multiple
        collapse-tags
        collapse-tags-tooltip
        placeholder="等級"
        class="filter-level"
      >
        <el-option label="DEBUG" value="debug" />
        <el-option label="INFO" value="info" />
        <el-option label="WARN" value="warn" />
        <el-option label="ERROR" value="error" />
      </el-select>

      <el-select v-model="sourceFilter" placeholder="來源" clearable class="filter-source">
        <el-option label="主進程" value="main" />
        <el-option label="渲染進程" value="renderer" />
      </el-select>

      <el-date-picker
        v-model="dateRange"
        type="daterange"
        range-separator="—"
        start-placeholder="起始日"
        end-placeholder="結束日"
        class="filter-date"
      />

      <el-input
        v-model="searchKeyword"
        placeholder="搜尋訊息關鍵字"
        clearable
        class="filter-search"
        @keyup.enter="handleSearch"
      />

      <el-button type="primary" @click="handleSearch">查詢</el-button>
      <el-button @click="handleReset">重置</el-button>
    </div>

    <!-- ── 表格 ──────────────────────────────────────── -->
    <el-table
      v-loading="loading"
      :data="rows"
      :row-class-name="rowClassName"
      height="100%"
      class="log-table"
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

      <el-table-column prop="createdAt" label="時間" width="200">
        <template #default="{row}">
          <span class="mono">{{ formatTime(row.createdAt) }}</span>
        </template>
      </el-table-column>

      <el-table-column prop="level" label="等級" width="80">
        <template #default="{row}">
          <el-tag :type="levelTagType(row.level)" size="small" disable-transitions>
            {{ row.level.toUpperCase() }}
          </el-tag>
        </template>
      </el-table-column>

      <el-table-column prop="source" label="來源" width="100" />

      <el-table-column prop="module" label="模組" width="160">
        <template #default="{row}">
          <span v-if="row.module" class="mono small">{{ row.module }}</span>
          <span v-else class="placeholder">—</span>
        </template>
      </el-table-column>

      <el-table-column prop="message" label="訊息" min-width="320" show-overflow-tooltip />
    </el-table>

    <!-- ── 分頁 ──────────────────────────────────────── -->
    <div class="pagination-bar">
      <el-pagination
        :current-page="currentPage"
        :page-size="pageSize"
        :total="total"
        :page-sizes="[50, 100, 200, 500]"
        layout="total, sizes, prev, pager, next, jumper"
        background
        @current-change="handlePageChange"
        @size-change="handlePageSizeChange"
      />
    </div>
  </div>
</template>

<style scoped>
.log-viewer {
  display: flex;
  flex-direction: column;
  height: 100vh;
  padding: 12px;
  gap: 10px;
  box-sizing: border-box;
}

.health-bar {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
  flex-shrink: 0;
  padding: 6px 10px;
  background: #f9fafb;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
}

.health-title {
  font-size: 12px;
  font-weight: 600;
  color: #6b7280;
}

.health-error {
  font-size: 12px;
  color: #d97706;
}

.filter-bar {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
  flex-shrink: 0;
}

.filter-level { width: 200px; }
.filter-source { width: 120px; }
.filter-date { width: 260px; }
.filter-search { width: 260px; }

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

.placeholder {
  color: #9ca3af;
}

.pagination-bar {
  display: flex;
  justify-content: flex-end;
  flex-shrink: 0;
}

/* 展開區塊 */
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
