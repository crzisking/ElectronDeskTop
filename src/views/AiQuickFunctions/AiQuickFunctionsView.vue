<script setup lang="ts">
/**
 * AI 快捷功能入口頁面
 *
 * 與「統一平台」設計一致：卡片網格，由 config 驅動。
 * 每張卡片對應一個 AI 工具入口（文本處理、摘要、問答等）。
 * 點擊後根據 openMode：
 *  - 'page'    ：跳轉到對應子路由（後續自行開發子頁面）
 *  - 'external'：外部瀏覽器打開
 *
 * 新增工具只需在 app-config.json 的 aiQuickFunctions.tools 中追加即可，
 * 無需修改此組件。
 */

import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useConfigStore } from '@/stores/config.store'
import type { AiTool } from '@/types/config.types'

const router = useRouter()
const configStore = useConfigStore()

/** 啟用的 AI 工具列表 */
const tools = computed<AiTool[]>(
  () => configStore.aiConfig?.tools.filter((t) => t.enabled) ?? []
)

/**
 * 點擊工具卡片
 * - openMode='page'     → 路由跳轉（子頁面由開發者自行實現）
 * - openMode='external' → 外部瀏覽器
 */
function handleOpen(tool: AiTool) {
  console.log('111',tool)
  if (tool.openMode === 'external' && tool.url) {
    window.open(tool.url, '_blank')
  } else if (tool.openMode === 'page' && tool.routeName) {
    router.push({ name: tool.routeName }).catch(() => {
      // 子路由尚未創建時，給出提示
      console.warn(`[AI] 路由 "${tool.routeName}" 尚未配置，請先在 router/index.ts 中添加對應路由`)
    })
  }
}
</script>

<template>
  <div class="ai-view">
    <!-- 頁面頭部 -->
    <div class="page-header">
      <div class="header-left">
        <h2 class="page-title">AI 快捷功能</h2>
        <p class="page-subtitle">選擇工具，開始智能輔助工作</p>
      </div>
    </div>

    <!-- 工具卡片網格 -->
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

    <!-- 空狀態 -->
    <el-empty
      v-if="tools.length === 0"
      description="尚未配置任何 AI 工具，請在 app-config.json 的 aiQuickFunctions.tools 中添加"
      :image-size="120"
    />
  </div>
</template>

<script lang="ts">
import { ArrowRight } from '@element-plus/icons-vue'
export default { components: { ArrowRight } }
</script>

<style scoped>
.ai-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 24px;
  box-sizing: border-box;
  gap: 20px;
}

.page-header {
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
