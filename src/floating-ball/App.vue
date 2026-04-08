<script setup lang="ts">
/**
 * 浮球窗口根組件
 *
 * 右鍵菜單改為原生 Menu（主進程 Menu.popup()）。
 * FloatingBall 組件直接調用 window.electronAPI.showContextMenu()，
 * 不再需要 Vue overlay 層，此組件只需渲染浮球本體。
 */
import FloatingBall from './FloatingBall.vue'
</script>

<template>
  <!-- 浮球窗口只渲染 60×60 的浮球，右鍵菜單由主進程原生彈出 -->
  <FloatingBall />
</template>

<style>
/*
 * 浮球窗口全局樣式（無 scoped，覆蓋 body）
 * body 需要完全透明，浮球圓形由 CSS border-radius 實現
 * overflow: hidden 防止出現滾動條
 */
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

html,
body {
  width: 80px;
  height: 80px;
  overflow: hidden;
  background: transparent;
  /* 禁用文字選中，避免拖動時出現選中效果 */
  user-select: none;
  -webkit-user-select: none;
}
</style>
