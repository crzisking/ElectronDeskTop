<script lang="ts" setup>
/**
 * 側邊欄底部收合按鈕。
 * 純展示,toggle 事件交父層。
 */
import {ArrowLeftBold} from '@element-plus/icons-vue'
import {useI18n} from 'vue-i18n'

defineProps<{
  collapsed: boolean
}>()

const emit = defineEmits<{
  (e: 'toggle'): void
}>()

const {t} = useI18n()
</script>

<template>
  <button
      :title="collapsed ? t('sidebar.expand') : t('sidebar.collapse')"
      class="collapse-handle"
      type="button"
      @click="emit('toggle')"
  >
    <el-icon :size="14" :style="{transform: collapsed ? 'rotate(180deg)' : 'none'}">
      <ArrowLeftBold/>
    </el-icon>
    <span v-show="!collapsed" class="collapse-label">{{ t('sidebar.collapse') }}</span>
  </button>
</template>

<style scoped>
.collapse-handle {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 30px;
  margin-top: 6px;
  border: none;
  background: transparent;
  color: var(--app-text-muted);
  cursor: pointer;
  border-radius: 6px;
  font-size: 12px;
  transition: background 0.15s, color 0.15s;
}

.collapse-handle:hover {
  background: var(--app-bg-surface);
  color: var(--app-text-primary);
}

.collapse-label {
  letter-spacing: 0.05em;
}
</style>
