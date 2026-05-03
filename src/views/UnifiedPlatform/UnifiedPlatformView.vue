<script setup lang="ts">
/**
 * 統一平台頁面 — Warm Editorial 風格
 *
 * 結構與 InternalFunctionsView 同一族系：
 *   eyebrow + display title + 副標題 + 搜索框 + section 標題 + 系統卡片網格
 *
 * 兩種狀態：
 *  1. 列表視圖：所有系統卡片
 *  2. 啟動器視圖：iframe 嵌入指定系統
 */

import {computed, ref} from 'vue'
import {useConfigStore} from '@/stores/config.store'
import SystemCard from './SystemCard.vue'
import SystemLauncher from './SystemLauncher.vue'
import type {SystemLink} from '@/types/config.types'
import {Search} from '@element-plus/icons-vue'

const configStore = useConfigStore()

const searchKeyword = ref('')
const activeSystem = ref<SystemLink | null>(null)

const filteredSystems = computed(() => {
  const kw = searchKeyword.value.trim().toLowerCase()
  if (!kw) return configStore.platformSystems
  return configStore.platformSystems.filter(
    (s) => s.name.toLowerCase().includes(kw) || s.description.toLowerCase().includes(kw)
  )
})

function handleOpenSystem(system: SystemLink) {
  switch (system.openMode) {
    case 'iframe':
      activeSystem.value = system
      break
    case 'electron-window':
      window.electronAPI.window.openChild(system.url, system.name)
      break
    case 'external-browser':
    default:
      window.open(system.url, '_blank')
      break
  }
}

function handleBack() {
  activeSystem.value = null
}

</script>

<template>
  <SystemLauncher v-if="activeSystem" :system="activeSystem" @back="handleBack" />

  <div v-else class="app-page platform-view">
    <div class="app-page-header app-page-header--compact">
      <div class="app-page-header__right">
        <div class="search-input">
          <el-input
            v-model="searchKeyword"
            placeholder="搜尋系統名稱或描述…"
            :prefix-icon="Search"
            clearable
          />
        </div>
      </div>
    </div>

    <div class="section-bar">
      <div class="app-section-title">
        <span class="app-section-title__main">所有系統</span>
        <span class="app-section-title__count">
          {{ String(configStore.platformSystems.length).padStart(2, '0') }} SYSTEMS
        </span>
      </div>
    </div>

    <div class="systems-grid">
      <SystemCard
        v-for="system in filteredSystems"
        :key="system.id"
        :system="system"
        @open="handleOpenSystem"
      />
    </div>

    <el-empty
      v-if="filteredSystems.length === 0 && configStore.platformSystems.length === 0"
      description="尚未配置任何系統，請編輯 app-config.json 的 unifiedPlatform.systems 字段"
      :image-size="120"
    />
    <el-empty
      v-else-if="filteredSystems.length === 0"
      :description="`未找到包含「${searchKeyword}」的系統`"
      :image-size="100"
    />
  </div>
</template>

<style scoped>
.search-input {
  position: relative;
  width: 320px;
}

.search-input :deep(.el-input__wrapper) {
  height: 40px;
}

.section-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
  margin-top: 6px;
}

.systems-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 18px;
  align-content: start;
}
</style>
