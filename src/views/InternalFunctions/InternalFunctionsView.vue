<script setup lang="ts">
/**
 * 內部功能入口頁面 — Warm Editorial 風格
 *
 * 結構：
 *  ── eyebrow（INTERNAL TOOLS · 內部工具）
 *  ── 大標題（內部 [功能] 中心，中間段斜體金色）
 *  ── 副標題
 *  ── 右側搜索框（帶 ⌘K 快捷鍵提示）
 *  ── Section（常用功能 · 06 ITEMS）+ filter pills（全部/流程/支援/報表）
 *  ── 卡片網格（每張卡片右上角分類 tag、左上圖標、標題、描述、底部元數據+箭頭）
 *  ── 「即將推出」虛線占位卡
 *  ── footer（系統運作正常 · build x.y.z）
 *
 * 卡片由 config.internalFunctions.tools 驅動。
 * 分類（流程/支援/報表）暫由 tool.id 啟發式判斷，後續可在 config 增加 category 字段。
 */

import {computed, ref} from 'vue'
import {useRouter} from 'vue-router'
import {useConfigStore} from '@/stores/config.store'
import {logger} from '@/utils/logger'
import type {InternalTool} from '@/types/config.types'
import {ArrowRight, Plus, Search} from '@element-plus/icons-vue'

const router = useRouter()
const configStore = useConfigStore()

/** 搜索關鍵詞 */
const searchKeyword = ref('')

/** 當前 filter pill 值（'all' | '流程' | '支援' | '報表'） */
const currentFilter = ref<'all' | '流程' | '支援' >('all')

/** Filter pills 配置 */
const filters: Array<{ value: 'all' | '流程' | '支援' ; label: string }> = [
  { value: 'all', label: '全部' },
  { value: '流程', label: '流程' },
  { value: '支援', label: '支援' },
]

/** 工具到分類的映射（啟發式：基於 id/name 關鍵字） */
function categorizeTool(tool: InternalTool): '流程' | '支援'  {
  const text = `${tool.id} ${tool.name}`.toLowerCase()
  if (/repair|報修|support|tools/.test(text)) return '支援'
  return '流程'
}

/** 所有啟用的功能 */
const allTools = computed<InternalTool[]>(
  () => configStore.functionsConfig?.tools.filter((t) => t.enabled) ?? []
)

/** 過濾後的功能列表（搜索 + 分類） */
const tools = computed<InternalTool[]>(() => {
  const kw = searchKeyword.value.trim().toLowerCase()
  return allTools.value.filter((t) => {
    if (currentFilter.value !== 'all' && categorizeTool(t) !== currentFilter.value) return false
    if (!kw) return true
    return t.name.toLowerCase().includes(kw) || t.description.toLowerCase().includes(kw)
  })
})

/** 卡片元數據（佔位文字，後續可由 API/配置提供） */
function toolMeta(tool: InternalTool): string {
  return `${tool.description}`
}

/** 點擊功能卡片 */
function handleOpen(tool: InternalTool) {
  if (tool.openMode === 'external' && tool.url) {
    window.open(tool.url, '_blank')
  } else if (tool.openMode === 'page' && tool.routeName) {
    router.push({name: tool.routeName}).catch((err) => {
      logger.warn('工具路由跳轉失敗', 'InternalFunctions', {routeName: tool.routeName, err})
    })
  }
}

/** 應用版本：從 app-config.json 的 version 字段讀取 */
const appVersion = computed(() => configStore.appConfig?.version ?? '—')
</script>

<template>
  <div class="app-page internal-functions-view">
    <!-- ── 頁面頂部：搜索框 ────────────────────────────────── -->
    <div class="app-page-header app-page-header--compact">
      <div class="app-page-header__right">
        <div class="search-input">
          <el-input
            v-model="searchKeyword"
            placeholder="搜尋功能名稱或描述…"
            :prefix-icon="Search"
            clearable
          />
        </div>
      </div>
    </div>

    <!-- ── Section 標題列 + Filter Pills ────────────────────── -->
    <div class="section-bar">
      <div class="app-section-title">
        <span class="app-section-title__main">常用功能</span>
        <span class="app-section-title__count">
          {{ String(allTools.length).padStart(2, '0') }} ITEMS
        </span>
      </div>
      <div class="filter-pills">
        <button
          v-for="f in filters"
          :key="f.value"
          type="button"
          class="app-pill"
          :class="{ 'is-active': currentFilter === f.value }"
          @click="currentFilter = f.value"
        >
          {{ f.label }}
        </button>
      </div>
    </div>

    <!-- ── 卡片網格 ───────────────────────────────────────── -->
    <div class="tools-grid">
      <div
        v-for="tool in tools"
        :key="tool.id"
        class="app-card app-card--interactive tool-card"
        @click="handleOpen(tool)"
      >
        <div class="tool-card__top">
          <div class="tool-card__icon">
            <el-icon :size="20">
              <component :is="tool.icon" />
            </el-icon>
          </div>
        </div>

        <div class="tool-card__body">
          <h3 class="tool-card__title">{{ tool.name }}</h3>
          <p class="tool-card__desc">{{ tool.description }}</p>
        </div>

        <div class="tool-card__footer">
          <span class="tool-card__meta">{{ toolMeta(tool) }}</span>
          <el-icon class="tool-card__arrow" :size="16"><ArrowRight /></el-icon>
        </div>
      </div>

      <!-- 即將推出占位卡 -->
      <div class="app-card app-card--dashed coming-soon">
        <div class="coming-soon__icon">
          <el-icon :size="22"><Plus /></el-icon>
        </div>
        <div class="coming-soon__title">即將推出</div>
        <div class="coming-soon__desc">更多企業內部工具陸續上線中</div>
      </div>
    </div>

    <!-- 空狀態 -->
    <el-empty
      v-if="tools.length === 0 && allTools.length === 0"
      description="尚未配置任何功能，請在 app-config.json 的 internalFunctions.tools 中添加"
      :image-size="120"
    />
    <el-empty
      v-else-if="tools.length === 0"
      :description="`未找到符合的功能`"
      :image-size="100"
    />

    <!-- ── 頁面底部 ───────────────────────────────────────── -->
    <div class="page-footer">
      <div class="page-footer__left">
        <span class="status-dot" />
        <span>系統運作正常</span>
        <span class="footer-sep">·</span>
      </div>
      <div class="page-footer__right">
        © {{ new Date().getFullYear() }} ICHIA Enterprise {{ appVersion }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.internal-functions-view {
  /* 繼承 .app-page 的 padding/gap，這裡僅作個別調整 */
}

/* ── 搜索框（含 ⌘K 提示） ────────────────────────────────── */
.search-input {
  position: relative;
  width: 320px;
}

.search-input :deep(.el-input__wrapper) {
  height: 40px;
}

.search-shortcut {
  position: absolute;
  right: 12px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 11px;
  letter-spacing: 0.08em;
  font-weight: 500;
  padding: 2px 8px;
  border-radius: 6px;
  background: var(--app-bg-elevated);
  border: 1px solid var(--app-border-subtle);
  color: var(--app-text-muted);
  pointer-events: none;
}

/* ── Section bar：標題 + filter pills ─────────────────────── */
.section-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
  margin-top: 6px;
}

.filter-pills {
  display: flex;
  gap: 6px;
}

/* ── 卡片網格 ────────────────────────────────────────────── */
.tools-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(248px, 1fr));
  gap: 18px;
  align-content: start;
  flex: 1;
  min-height: 0;
}

.tool-card {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 22px 22px 18px;
  min-height: 200px;
}

.tool-card__top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.tool-card__icon {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  background: var(--app-bg-elevated);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--app-text-primary);
  flex-shrink: 0;
}

.tool-card__body {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.tool-card__title {
  font-size: 17px;
  font-weight: 600;
  color: var(--app-text-primary);
  margin: 0;
  letter-spacing: -0.005em;
}

.tool-card__desc {
  font-size: 13px;
  line-height: 1.55;
  color: var(--app-text-secondary);
  margin: 0;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.tool-card__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: 12px;
  border-top: 1px solid var(--app-border-subtle);
}

.tool-card__meta {
  font-size: 12px;
  color: var(--app-text-muted);
  letter-spacing: 0.02em;
}

.tool-card__arrow {
  color: var(--app-text-muted);
  transition: transform 0.2s ease, color 0.2s ease;
}

.tool-card:hover .tool-card__arrow {
  color: var(--app-text-primary);
  transform: translateX(2px);
}

/* ── 即將推出占位卡 ─────────────────────────────────────── */
.coming-soon {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 28px;
  min-height: 200px;
  text-align: center;
  color: var(--app-text-muted);
}

.coming-soon__icon {
  width: 44px;
  height: 44px;
  border-radius: 999px;
  border: 1.5px dashed var(--app-border-default);
  display: flex;
  align-items: center;
  justify-content: center;
}

.coming-soon__title {
  font-size: 15px;
  font-weight: 600;
  color: var(--app-text-secondary);
}

.coming-soon__desc {
  font-size: 12px;
  color: var(--app-text-muted);
}

/* ── 頁面底部 ────────────────────────────────────────────── */
.page-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  color: var(--app-text-muted);
  letter-spacing: 0.03em;
  padding-top: 8px;
  flex-shrink: 0;
}

.page-footer__left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: var(--app-success);
  box-shadow: 0 0 0 3px rgba(79, 125, 58, 0.15);
}

.footer-sep {
  color: var(--app-border-strong);
}
</style>
