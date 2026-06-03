<script lang="ts" setup>
/**
 * 日誌查詢過濾條 — 等級 / 來源 / 模組 / 日期 / 關鍵字 + 查詢/重置按鈕。
 *
 * 5 個過濾條件全部用 v-model 雙向綁,父層自己組 query。
 * 模組下拉 filterable(模組數可能 50+,捲動找太慢)。
 */
import type {LogLevel, LogSource} from '../types'

defineProps<{
  modelLevel: LogLevel[]
  modelSource: LogSource | ''
  modelModule: string
  modelDateRange: [Date, Date] | null
  modelKeyword: string
  /** 模組下拉的選項清單 */
  moduleOptions: string[]
}>()

const emit = defineEmits<{
  (e: 'update:modelLevel', v: LogLevel[]): void
  (e: 'update:modelSource', v: LogSource | ''): void
  (e: 'update:modelModule', v: string): void
  (e: 'update:modelDateRange', v: [Date, Date] | null): void
  (e: 'update:modelKeyword', v: string): void
  (e: 'search'): void
  (e: 'reset'): void
}>()
</script>

<template>
  <div class="filter-bar">
    <el-select
        :model-value="modelLevel"
        class="filter-level"
        collapse-tags
        collapse-tags-tooltip
        multiple
        placeholder="等級"
        @update:model-value="emit('update:modelLevel', $event)"
    >
      <el-option label="DEBUG" value="debug"/>
      <el-option label="INFO" value="info"/>
      <el-option label="WARN" value="warn"/>
      <el-option label="ERROR" value="error"/>
    </el-select>

    <el-select
        :model-value="modelSource"
        class="filter-source"
        clearable
        placeholder="來源"
        @update:model-value="emit('update:modelSource', $event)"
    >
      <el-option label="主進程" value="main"/>
      <el-option label="渲染進程" value="renderer"/>
    </el-select>

    <!--
      模組下拉:filterable=可輸入過濾。模組名可能 50+ 個,靠捲動找太慢。
      選項從 DB 拉 distinct,按出現頻率排序,常用的在最上面。
    -->
    <el-select
        :model-value="modelModule"
        class="filter-module"
        clearable
        filterable
        placeholder="模組"
        @update:model-value="emit('update:modelModule', $event)"
    >
      <el-option v-for="m in moduleOptions" :key="m" :label="m" :value="m"/>
    </el-select>

    <el-date-picker
        :model-value="modelDateRange"
        class="filter-date"
        end-placeholder="結束日"
        range-separator="—"
        start-placeholder="起始日"
        type="daterange"
        @update:model-value="emit('update:modelDateRange', $event as [Date, Date] | null)"
    />

    <el-input
        :model-value="modelKeyword"
        class="filter-search"
        clearable
        placeholder="搜尋訊息關鍵字"
        @keyup.enter="emit('search')"
        @update:model-value="emit('update:modelKeyword', $event)"
    />

    <el-button type="primary" @click="emit('search')">查詢</el-button>
    <el-button @click="emit('reset')">重置</el-button>
  </div>
</template>

<style scoped>
.filter-bar {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
  flex-shrink: 0;
}

.filter-level {
  width: 200px;
}

.filter-source {
  width: 120px;
}

.filter-module {
  width: 200px;
}

.filter-date {
  width: 260px;
}

.filter-search {
  width: 240px;
}
</style>
