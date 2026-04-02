<script setup lang="ts">
/**
 * 通用加載狀態組件
 * 用於頁面初始化、數據請求期間的加載提示
 */
defineProps<{
  /** 加載提示文字，默認"加載中..." */
  text?: string
  /** 是否全屏遮罩（默認 false，在父容器內居中） */
  fullscreen?: boolean
}>()
</script>

<template>
  <div class="loading-spinner" :class="{ 'is-fullscreen': fullscreen }">
    <el-icon :size="36" class="spin-icon"><Loading /></el-icon>
    <span class="spin-text">{{ text ?? '加載中...' }}</span>
  </div>
</template>

<style scoped>
.loading-spinner {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 40px;
  color: var(--el-text-color-secondary);
}

.is-fullscreen {
  position: fixed;
  inset: 0;
  background: rgba(255, 255, 255, 0.85);
  z-index: 9999;
}

.spin-icon {
  color: var(--el-color-primary);
  animation: rotate 1s linear infinite;
}

@keyframes rotate {
  to { transform: rotate(360deg); }
}

.spin-text {
  font-size: 14px;
}
</style>
