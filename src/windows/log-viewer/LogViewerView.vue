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

    <LogTable
        :format-time="formatTime"
        :loading="loading"
        :pretty-json="prettyJson"
        :rows="rows"
        @pick-module="onPickModule"
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
</style>
