<script setup lang="ts">
/**
 * 聯繫人搜索欄
 *
 * 帶防抖的搜索輸入框（300ms 延遲，減少無效 API 請求）。
 * 用戶輸入停止 300ms 後自動觸發搜索。
 */

import { ref, watch } from 'vue'
import { Search } from '@element-plus/icons-vue'

const props = defineProps<{
  /** 是否正在搜索中（顯示加載狀態） */
  loading?: boolean
}>()

const emit = defineEmits<{
  /** 觸發搜索事件，payload 為搜索關鍵詞 */
  (e: 'search', keyword: string): void
}>()

const keyword = ref('')
let debounceTimer: ReturnType<typeof setTimeout> | null = null

/** 監聽輸入變化，防抖 300ms 後觸發搜索 */
watch(keyword, (val) => {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    emit('search', val.trim())
  }, 300)
})

/** 清空輸入 */
function clearKeyword() {
  keyword.value = ''
  emit('search', '')
}
</script>

<template>
  <div class="search-bar">
    <el-input
      v-model="keyword"
      size="large"
      :prefix-icon="Search"
      placeholder="輸入問題關鍵詞（如：ERP 故障、報銷審批、IT 設備...）"
      clearable
      :loading="loading"
      @clear="clearKeyword"
    />
    <p class="search-hint">
      根據問題描述查找負責人，然後直接發送郵件聯繫
    </p>
  </div>
</template>

<style scoped>
.search-bar { display: flex; flex-direction: column; gap: 8px; }
.search-hint { margin: 0; font-size: 12px; color: var(--el-text-color-placeholder); }
</style>
