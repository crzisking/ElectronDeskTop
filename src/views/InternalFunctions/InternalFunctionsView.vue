<script setup lang="ts">
/**
 * 內部功能入口頁面
 *
 * 卡片網格，由 config 驅動（app-config.json → internalFunctions.tools）。
 * 可同時放 AI 工具與公司內部功能，每張卡片對應一個功能入口。
 * 點擊後根據 openMode：
 *  - 'page'    ：跳轉到對應子路由
 *  - 'external'：外部瀏覽器打開
 *
 * 新增功能只需在 app-config.json 的 internalFunctions.tools 中追加即可，
 * 無需修改此組件。
 */

import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useConfigStore } from '@/stores/config.store'
import type { InternalTool } from '@/types/config.types'
import {Search} from "@element-plus/icons-vue";

const router = useRouter()
const configStore = useConfigStore()

/** 搜索關鍵詞 */
const searchKeyword = ref('')

/** 所有啟用的功能 */
const allTools = computed<InternalTool[]>(
  () => configStore.functionsConfig?.tools.filter((t) => t.enabled) ?? []
)

/** 過濾後的功能列表 */
const tools = computed<InternalTool[]>(() => {
  const kw = searchKeyword.value.trim().toLowerCase()
  if (!kw) return allTools.value
  return allTools.value.filter(
    (t) =>
      t.name.toLowerCase().includes(kw) ||
      t.description.toLowerCase().includes(kw)
  )
})

/**
 * 點擊功能卡片
 * - openMode='page'     → 路由跳轉
 * - openMode='external' → 外部瀏覽器
 */
function handleOpen(tool: InternalTool) {
  if (tool.openMode === 'external' && tool.url) {
    window.open(tool.url, '_blank')
  } else if (tool.openMode === 'page' && tool.routeName) {
    router.push({ name: tool.routeName }).catch(() => {
      console.warn(`[InternalFunctions] 路由 "${tool.routeName}" 尚未配置，請先在 router/index.ts 中添加對應路由`)
    })
  }
}
</script>

<template>
  <div class="internal-functions-view">
    <!-- 頁面頭部 -->
    <div class="page-header">
      <div class="header-left">
        <h2 class="page-title">內部功能</h2>
        <p class="page-subtitle">選擇功能，快速進入對應工具</p>
      </div>
      <!-- 搜索框 -->
      <el-input
        v-model="searchKeyword"
        placeholder="搜索功能名稱或描述..."
        :prefix-icon="Search"
        clearable
        style="width: 260px"
      />
    </div>

    <!-- 功能卡片網格 -->
    <div class="tools-grid">
      <div
        v-for="tool in tools"
        :key="tool.id"
        class="tool-card"
        @click="handleOpen(tool)"
      >
        <!-- 圖標區 -->
        <div class="card-icon">
          <el-icon :size="32">
            <component :is="tool.icon" />
          </el-icon>
        </div>

        <!-- 文字區 -->
        <div class="card-body">
          <div class="card-name">{{ tool.name }}</div>
          <div class="card-desc">{{ tool.description }}</div>
        </div>

        <!-- 進入箭頭 -->
        <el-icon class="card-arrow" :size="16">
          <ArrowRight />
        </el-icon>
      </div>
    </div>

    <!-- 空狀態：未配置任何功能 -->
    <el-empty
      v-if="tools.length === 0 && allTools.length === 0"
      description="尚未配置任何功能，請在 app-config.json 的 internalFunctions.tools 中添加"
      :image-size="120"
    />

    <!-- 空狀態：搜索無結果 -->
    <el-empty
      v-else-if="tools.length === 0"
      :description="`未找到包含「${searchKeyword}」的功能`"
      :image-size="100"
    />
  </div>
</template>

<script lang="ts">
import { ArrowRight } from '@element-plus/icons-vue'
export default { components: { ArrowRight } }
</script>

<style scoped>
.internal-functions-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 24px;
  box-sizing: border-box;
  gap: 20px;
}

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

/* 工具卡片網格：最小 300px，自動填充 */
.tools-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 16px;
  overflow-y: auto;
  align-content: start;
}

/* 工具卡片 */
.tool-card {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 20px;
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 10px;
  cursor: pointer;
  transition: box-shadow 0.2s, border-color 0.2s, transform 0.1s;
}

.tool-card:hover {
  border-color: var(--el-color-primary-light-5);
  box-shadow: 0 4px 16px rgba(64, 158, 255, 0.12);
  transform: translateY(-1px);
}

.tool-card:active {
  transform: translateY(0);
}

/* 圖標圓形背景 */
.card-icon {
  width: 56px;
  height: 56px;
  border-radius: 12px;
  background: var(--el-color-primary-light-9);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: var(--el-color-primary);
}

.card-body {
  flex: 1;
  min-width: 0;
}

.card-name {
  font-size: 15px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  margin-bottom: 4px;
}

.card-desc {
  font-size: 13px;
  color: var(--el-text-color-secondary);
  line-height: 1.4;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.card-arrow {
  color: var(--el-text-color-placeholder);
  flex-shrink: 0;
  transition: color 0.2s;
}

.tool-card:hover .card-arrow {
  color: var(--el-color-primary);
}
</style>
