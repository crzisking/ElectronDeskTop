<script lang="ts" setup>
/**
 * 通用工具卡片 — 內部功能 / 個人功能 / 未來其它「工具入口頁」共用。
 *
 * 結構:左上圖標 → 標題 → 描述 → 底部 meta + 箭頭。
 * Props 接純值;不關心 i18n / config,翻譯由父層做完再傳進來。
 */
import {ArrowRight} from '@element-plus/icons-vue'

defineProps<{
  /** Element Plus icon 組件名(動態解析) */
  icon: string
  title: string
  description: string
  /** 底部 meta 文字(目前各頁多半傳 description 本身) */
  meta: string
}>()

defineEmits<{
  (e: 'click'): void
}>()
</script>

<template>
  <div class="app-card app-card--interactive tool-card" @click="$emit('click')">
    <div class="tool-card__top">
      <div class="tool-card__icon">
        <el-icon :size="20">
          <component :is="icon"/>
        </el-icon>
      </div>
    </div>

    <div class="tool-card__body">
      <h3 class="tool-card__title">{{ title }}</h3>
      <p class="tool-card__desc">{{ description }}</p>
    </div>

    <div class="tool-card__footer">
      <span class="tool-card__meta">{{ meta }}</span>
      <el-icon :size="16" class="tool-card__arrow">
        <ArrowRight/>
      </el-icon>
    </div>
  </div>
</template>

<style scoped>
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
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}

.tool-card__arrow {
  color: var(--app-text-muted);
  transition: transform 0.2s ease, color 0.2s ease;
  flex-shrink: 0;
}

.tool-card:hover .tool-card__arrow {
  color: var(--app-text-primary);
  transform: translateX(2px);
}
</style>
