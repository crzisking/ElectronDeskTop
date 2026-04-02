<script setup lang="ts">
/**
 * 統一平台頁面
 *
 * 展示公司所有內部系統的快捷入口。
 * 系統列表從 configStore.platformSystems 讀取（config 驅動）。
 *
 * 兩種狀態：
 *  1. 列表視圖：展示所有系統卡片（搜索過濾）
 *  2. 啟動器視圖：iframe 嵌入指定系統
 *
 * 打開方式：
 *  - iframe 模式：切換到啟動器視圖
 *  - external-browser 模式：直接調用 window.open
 */

import { ref, computed } from 'vue'
import { useConfigStore } from '@/stores/config.store'
import SystemCard from './SystemCard.vue'
import SystemLauncher from './SystemLauncher.vue'
import type { SystemLink } from '@/types/config.types'

const configStore = useConfigStore()

/** 搜索關鍵詞（用於過濾系統卡片） */
const searchKeyword = ref('')

/** 當前在 iframe 中打開的系統（null = 顯示列表） */
const activeSystem = ref<SystemLink | null>(null)

/** 過濾後的系統列表 */
const filteredSystems = computed(() => {
  const kw = searchKeyword.value.trim().toLowerCase()
  if (!kw) return configStore.platformSystems

  return configStore.platformSystems.filter(
    (s) =>
      s.name.toLowerCase().includes(kw) ||
      s.description.toLowerCase().includes(kw)
  )
})

/**
 * 處理系統卡片點擊
 * 根據 openMode 決定在 iframe 嵌入還是在外部瀏覽器打開
 */
function handleOpenSystem(system: SystemLink) {
  if (system.openMode === 'iframe') {
    // 切換到 iframe 啟動器視圖
    activeSystem.value = system
  } else {
    // 外部瀏覽器模式：直接打開，無需 SSO 注入（由系統自身處理）
    window.open(system.url, '_blank')
  }
}

/** 從 iframe 啟動器返回列表 */
function handleBack() {
  activeSystem.value = null
}
</script>

<template>
  <!-- iframe 啟動器視圖（全屏，替換列表） -->
  <SystemLauncher
    v-if="activeSystem"
    :system="activeSystem"
    @back="handleBack"
  />

  <!-- 系統列表視圖 -->
  <div v-else class="platform-view">
    <!-- 頁面頭部 -->
    <div class="page-header">
      <div class="header-left">
        <h2 class="page-title">統一平台</h2>
        <p class="page-subtitle">點擊卡片快速訪問公司內部系統</p>
      </div>
      <!-- 搜索框 -->
      <el-input
        v-model="searchKeyword"
        placeholder="搜索系統名稱或描述..."
        :prefix-icon="Search"
        clearable
        style="width: 260px"
      />
    </div>

    <!-- 系統卡片網格 -->
    <div class="systems-grid">
      <SystemCard
        v-for="system in filteredSystems"
        :key="system.id"
        :system="system"
        @open="handleOpenSystem"
      />

      <!-- 空狀態：無系統配置 -->
      <el-empty
        v-if="filteredSystems.length === 0 && configStore.platformSystems.length === 0"
        description="尚未配置任何系統，請編輯 app-config.json 的 unifiedPlatform.systems 字段"
        :image-size="120"
      />

      <!-- 空狀態：搜索無結果 -->
      <el-empty
        v-else-if="filteredSystems.length === 0"
        :description="`未找到包含「${searchKeyword}」的系統`"
        :image-size="100"
      />
    </div>
  </div>
</template>

<script lang="ts">
import { Search } from '@element-plus/icons-vue'
export default { components: { Search } }
</script>

<style scoped>
.platform-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 24px;
  box-sizing: border-box;
  gap: 20px;
}

/* 頁面頭部 */
.page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  flex-shrink: 0;
}

.header-left {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.page-title {
  font-size: 22px;
  font-weight: 700;
  color: var(--el-text-color-primary);
  margin: 0;
}

.page-subtitle {
  font-size: 13px;
  color: var(--el-text-color-secondary);
  margin: 0;
}

/* 系統卡片網格佈局 */
.systems-grid {
  display: grid;
  /* 響應式：最小 280px，自動填充列數 */
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 16px;
  overflow-y: auto;
  padding-bottom: 16px;
}

.systems-grid::-webkit-scrollbar {
  width: 4px;
}
</style>
