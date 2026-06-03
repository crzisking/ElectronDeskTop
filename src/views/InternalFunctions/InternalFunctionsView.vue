<script setup lang="ts">
/**
 * 內部功能入口 — Warm Editorial 風格,薄殼。
 *
 * 結構:搜尋框 + 「常用功能」section + filter pills + 卡片網格 + 底部。
 * 共用元件:ToolCard / ComingSoonCard / PageFooter / FilterPills(都在 components/common/)。
 *
 * 卡片由 config.internalFunctions.tools 驅動。分類(流程/支援)由 tool.id 啟發式判斷,
 * 後續可在 config 增加 category 字段。
 */

import {computed, ref} from 'vue'
import {useRouter} from 'vue-router'
import {useI18n} from 'vue-i18n'
import {Search} from '@element-plus/icons-vue'
import {useConfigStore} from '@/stores/config.store'
import {useConfigText} from '@/shared/composables/useConfigText'
import {logger} from '@/shared/utils/logger'
import type {InternalTool} from '@/types/config'
import ToolCard from '@/components/common/ToolCard.vue'
import ComingSoonCard from '@/components/common/ComingSoonCard.vue'
import PageFooter from '@/components/common/PageFooter.vue'
import FilterPills from '@/components/common/FilterPills.vue'

const router = useRouter()
const configStore = useConfigStore()
const {t} = useI18n()
const {ct} = useConfigText()

function toolName(tool: InternalTool): string {
  return ct(`config.tools.${tool.id}.name`, tool.name)
}

function toolDesc(tool: InternalTool): string {
  return ct(`config.tools.${tool.id}.description`, tool.description)
}

const searchKeyword = ref('')

/**
 * 過濾分類。value 用穩定英文字符串(不隨語言變化);label 走 i18n。
 */
type FilterValue = 'all' | 'process' | 'support'

const currentFilter = ref<FilterValue>('all')

const filterOptions = computed(() => [
  {value: 'all', label: t('internal.filterAll')},
  {value: 'process', label: t('internal.filterProcess')},
  {value: 'support', label: t('internal.filterSupport')},
])

/** 工具到分類的映射(啟發式:基於 id/name 關鍵字) */
function categorizeTool(tool: InternalTool): Exclude<FilterValue, 'all'> {
  const text = `${tool.id} ${tool.name}`.toLowerCase()
  if (/repair|報修|support|tools/.test(text)) return 'support'
  return 'process'
}

const allTools = computed<InternalTool[]>(
    () => configStore.functionsConfig?.tools.filter((tl) => tl.enabled) ?? [],
)

const tools = computed<InternalTool[]>(() => {
  const kw = searchKeyword.value.trim().toLowerCase()
  return allTools.value.filter((tool) => {
    if (currentFilter.value !== 'all' && categorizeTool(tool) !== currentFilter.value) return false
    if (!kw) return true
    // 同時匹配翻譯後文本和 config 原值
    const name = toolName(tool).toLowerCase()
    const desc = toolDesc(tool).toLowerCase()
    return name.includes(kw)
        || desc.includes(kw)
        || tool.name.toLowerCase().includes(kw)
        || tool.description.toLowerCase().includes(kw)
  })
})

function handleOpen(tool: InternalTool) {
  if (tool.openMode === 'external' && tool.url) {
    window.open(tool.url, '_blank')
  } else if (tool.openMode === 'page' && tool.routeName) {
    router.push({name: tool.routeName}).catch((err) => {
      logger.warn('工具路由跳轉失敗', 'InternalFunctions', {routeName: tool.routeName, err})
    })
  }
}

const appVersion = computed(() => configStore.appConfig?.version ?? '—')
</script>

<template>
  <div class="app-page internal-functions-view">
    <!-- ── 搜尋框 ──────────────────────────────────────── -->
    <div class="app-page-header app-page-header--compact">
      <div class="app-page-header__right">
        <div class="search-input">
          <el-input
              v-model="searchKeyword"
              :placeholder="t('internal.searchPlaceholder')"
              :prefix-icon="Search"
              clearable
          />
        </div>
      </div>
    </div>

    <!-- ── Section 標題 + Filter Pills ─────────────────── -->
    <div class="section-bar">
      <div class="app-section-title">
        <span class="app-section-title__main">{{ t('internal.commonTools') }}</span>
        <span class="app-section-title__count">
          {{ String(allTools.length).padStart(2, '0') }} {{ t('internal.itemsLabel') }}
        </span>
      </div>
      <FilterPills v-model="currentFilter" :options="filterOptions"/>
    </div>

    <!-- ── 卡片網格 ───────────────────────────────────── -->
    <div class="tools-grid">
      <ToolCard
          v-for="tool in tools"
          :key="tool.id"
          :description="toolDesc(tool)"
          :icon="tool.icon"
          :meta="toolDesc(tool)"
          :title="toolName(tool)"
          @click="handleOpen(tool)"
      />
      <ComingSoonCard :description="t('internal.comingSoonDesc')" :title="t('internal.comingSoon')"/>
    </div>

    <!-- 空狀態 -->
    <el-empty
        v-if="tools.length === 0 && allTools.length === 0"
        :description="t('internal.emptyAll')"
        :image-size="120"
    />
    <el-empty
        v-else-if="tools.length === 0"
        :description="t('internal.emptySearch')"
        :image-size="100"
    />

    <PageFooter :version="appVersion"/>
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

.tools-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(248px, 1fr));
  gap: 18px;
  align-content: start;
  flex: 1;
  min-height: 0;
}
</style>
