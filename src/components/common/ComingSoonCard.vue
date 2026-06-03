<script lang="ts" setup>
/**
 * 「即將推出」虛線占位卡 — 工具網格末尾。
 * 純展示,無互動。
 */
import {Plus} from '@element-plus/icons-vue'

defineProps<{
  title: string
  description: string
}>()
</script>

<template>
  <div class="app-card app-card--dashed coming-soon">
    <div class="coming-soon__icon">
      <el-icon :size="22">
        <Plus/>
      </el-icon>
    </div>
    <div class="coming-soon__title">{{ title }}</div>
    <div class="coming-soon__desc">{{ description }}</div>
  </div>
</template>

<style scoped>
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
</style>
