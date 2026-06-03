<script lang="ts" setup>
/**
 * 通用 filter pills — 一排可點切換的標籤按鈕。
 *
 * v-model 綁當前選中值;options 由父層傳 {value, label}[]。
 * 樣式走 .app-pill(全局 token 樣式),這裡只負責 layout + active 切換。
 */

defineProps<{
  modelValue: string
  options: Array<{ value: string; label: string }>
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', v: string): void
}>()
</script>

<template>
  <div class="filter-pills">
    <button
        v-for="opt in options"
        :key="opt.value"
        :class="{'is-active': modelValue === opt.value}"
        class="app-pill"
        type="button"
        @click="emit('update:modelValue', opt.value)"
    >
      {{ opt.label }}
    </button>
  </div>
</template>

<style scoped>
.filter-pills {
  display: flex;
  gap: 6px;
}
</style>
