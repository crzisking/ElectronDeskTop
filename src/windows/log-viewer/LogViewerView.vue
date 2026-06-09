<script lang="ts" setup>
/**
 * 日誌查看器主畫面 — 薄殼。
 *
 * 拆 3 個子件:
 *   LogHealthCard   採集健康狀態
 *   LogFilterBar    等級 / 來源 / 模組 / 日期 / 關鍵字過濾
 *   LogTable        el-table + 展開行 + 點模組快速過濾
 *
 * 本檔保留所有 state + query 邏輯 + 兩個格式化函式(formatTime / prettyJson)注入子件。
 */

import {onMounted, ref} from 'vue'
import {ElMessage} from 'element-plus'
import LogHealthCard from './components/LogHealthCard.vue'
import LogFilterBar from './components/LogFilterBar.vue'
import LogTable from './components/LogTable.vue'
import type {LogLevel, LogRow, LogSource, WorkHealth} from './types'

// ── 過濾條件 ────────────────────────────────────────────────────
const levelFilter = ref<LogLevel[]>([])
const sourceFilter = ref<LogSource | ''>('')
const moduleFilter = ref<string>('')
const moduleOptions = ref<string[]>([])
const searchKeyword = ref('')
const dateRange = ref<[Date, Date] | null>(null)
/** trace 過濾:點 trace cell 設這個,清掉就回正常列表 */
const traceFilter = ref<string>('')

// ── 分頁 + 資料 ─────────────────────────────────────────────────
const currentPage = ref(1)
const pageSize = ref(200)
const rows = ref<LogRow[]>([])
const total = ref(0)
const loading = ref(false)

// ── 採集健康(只此密碼保護窗口可見)─────────────────────────────
const health = ref<WorkHealth | null>(null)

async function loadHealth() {
  try {
    health.value = await window.logViewerAPI.workHealth()
  } catch {
    health.value = null
  }
}

// ── 查詢 ────────────────────────────────────────────────────────

/**
 * 把目前 UI 狀態組成 query params 傳給主進程。
 * 注意:所有 ref 值都要「拆出純值」再放進 params。
 * 直接放 levelFilter.value 會帶 Vue 響應式 Proxy,IPC structuredClone 會炸。
 */
async function runQuery() {
  loading.value = true
  try {
    const params: Record<string, unknown> = {
      limit: pageSize.value,
      offset: (currentPage.value - 1) * pageSize.value,
    }
    if (levelFilter.value.length > 0) params.level = [...levelFilter.value]
    if (sourceFilter.value) params.source = sourceFilter.value
    if (moduleFilter.value) params.module = moduleFilter.value
    if (searchKeyword.value.trim()) params.search = searchKeyword.value.trim()
    if (traceFilter.value) params.traceId = traceFilter.value
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

function handleSearch() {
  currentPage.value = 1
  runQuery()
}

function handleReset() {
  levelFilter.value = []
  sourceFilter.value = ''
  moduleFilter.value = ''
  searchKeyword.value = ''
  dateRange.value = null
  traceFilter.value = ''
  currentPage.value = 1
  runQuery()
  void loadModules()
}

async function loadModules() {
  try {
    moduleOptions.value = await window.logViewerAPI.listModules()
  } catch {
    moduleOptions.value = []
  }
}

function handlePageChange(page: number) {
  currentPage.value = page
  runQuery()
}

function handlePageSizeChange(size: number) {
  pageSize.value = size
  currentPage.value = 1
  runQuery()
}

/** 點表格內模組名 → 自動套用過濾並查 */
function onPickModule(m: string) {
  moduleFilter.value = m
  handleSearch()
}

/**
 * 點表格內 trace ID → 過濾整條 trace 的所有 log。
 * 同時清掉其他過濾(level/source/module/search/date),不然會雙重過濾把目標 trace 的部分 log 也擋掉。
 * 看完點「清除 trace」回到正常列表。
 */
function onPickTrace(traceId: string) {
  traceFilter.value = traceId
  // 清掉其他可能干擾的過濾 — 看一條 trace 就是要看「該 trace 的全部」,不該再被別的條件擋
  levelFilter.value = []
  sourceFilter.value = ''
  moduleFilter.value = ''
  searchKeyword.value = ''
  dateRange.value = null
  handleSearch()
}

function clearTraceFilter() {
  traceFilter.value = ''
  handleSearch()
}

// ── 格式化(注入到子件)─────────────────────────────────────────

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

/** JSON 字串美化(展開時顯示 args 用) */
function prettyJson(jsonStr: string | null): string {
  if (!jsonStr) return ''
  try {
    return JSON.stringify(JSON.parse(jsonStr), null, 2)
  } catch {
    return jsonStr
  }
}

// ── 初始載入 ────────────────────────────────────────────────────
onMounted(() => {
  runQuery()
  loadHealth()
  loadModules()
})
</script>

<template>
  <div class="log-viewer">
    <LogHealthCard :format-time="formatTime" :health="health" @refresh="loadHealth"/>

    <LogFilterBar
        v-model:model-date-range="dateRange"
        v-model:model-keyword="searchKeyword"
        v-model:model-level="levelFilter"
        v-model:model-module="moduleFilter"
        v-model:model-source="sourceFilter"
        :module-options="moduleOptions"
        @reset="handleReset"
        @search="handleSearch"
    />

    <!-- trace 過濾啟用時顯示一個 sticky 提示條,告訴使用者目前正在看單一 trace,提供「清除」按鈕 -->
    <div v-if="traceFilter" class="trace-banner">
      <span class="trace-banner__label">正在查看 Trace:</span>
      <code class="mono">{{ traceFilter }}</code>
      <el-button link size="small" type="primary" @click="clearTraceFilter">清除 trace 過濾</el-button>
    </div>

    <LogTable
        :format-time="formatTime"
        :loading="loading"
        :pretty-json="prettyJson"
        :rows="rows"
        @pick-module="onPickModule"
        @pick-trace="onPickTrace"
    />

    <div class="pagination-bar">
      <el-pagination
          :current-page="currentPage"
          :page-size="pageSize"
          :page-sizes="[50, 100, 200, 500]"
          :total="total"
          background
          layout="total, sizes, prev, pager, next, jumper"
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

.pagination-bar {
  display: flex;
  justify-content: flex-end;
  flex-shrink: 0;
}

/* Trace 過濾橫幅:紫色系與 LogTable trace cell 視覺一致,提示目前 scope 已收窄 */
.trace-banner {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  background: #faf5ff;
  border: 1px solid #d8b4fe;
  border-radius: 6px;
  flex-shrink: 0;
}

.trace-banner__label {
  font-size: 13px;
  color: #581c87;
  font-weight: 500;
}

.mono {
  font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
  font-size: 12px;
}
</style>
