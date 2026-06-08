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
import {useI18n} from 'vue-i18n'
import {useConfigStore} from '@/stores/config.store'
import {useConfigText} from '@/shared/composables/useConfigText'
import SystemCard from './SystemCard.vue'
import SystemLauncher from './SystemLauncher.vue'
import type {SystemLink} from '@shared/types/config'
import {Search} from '@element-plus/icons-vue'

const configStore = useConfigStore()
const {t} = useI18n()
const {ct} = useConfigText()

const searchKeyword = ref('')
const activeSystem = ref<SystemLink | null>(null)

// 搜尋同時匹配「JSON 原文」和「翻譯後文本」，
// 確保用戶在英文界面下也能用英文關鍵字搜到對應的系統
const filteredSystems = computed(() => {
  const kw = searchKeyword.value.trim().toLowerCase()
  if (!kw) return configStore.platformSystems
  return configStore.platformSystems.filter((s) => {
    const name = ct(`config.systems.${s.id}.name`, s.name).toLowerCase()
    const desc = ct(`config.systems.${s.id}.description`, s.description).toLowerCase()
    return s.name.toLowerCase().includes(kw)
      || s.description.toLowerCase().includes(kw)
      || name.includes(kw)
      || desc.includes(kw)
  })
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
          <!-- 原文 placeholder：搜尋系統名稱或描述… -->
          <el-input
            v-model="searchKeyword"
            :placeholder="t('platform.searchPlaceholder')"
            :prefix-icon="Search"
            clearable
          />
        </div>
      </div>
    </div>

    <div class="section-bar">
      <div class="app-section-title">
        <!-- 原文：所有系統 -->
        <span class="app-section-title__main">{{ t('platform.allSystems') }}</span>
        <span class="app-section-title__count">
          {{ String(configStore.platformSystems.length).padStart(2, '0') }} {{ t('platform.systemsLabel') }}
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

    <!-- 原文：尚未配置任何系統，請編輯 app-config.json 的 unifiedPlatform.systems 字段 -->
    <el-empty
      v-if="filteredSystems.length === 0 && configStore.platformSystems.length === 0"
      :description="t('platform.emptyAll')"
      :image-size="120"
    />
    <!-- 原文：未找到包含「{keyword}」的系統 -->
    <el-empty
      v-else-if="filteredSystems.length === 0"
      :description="t('platform.emptySearch', {keyword: searchKeyword})"
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
