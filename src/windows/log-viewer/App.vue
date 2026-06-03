<script lang="ts" setup>
/**
 * 日誌查看器根組件。
 * 結構簡單,直接渲染 LogViewerView,不做佈局拆分。
 */
import LogViewerView from './LogViewerView.vue'
</script>

<template>
  <LogViewerView/>
</template>

<style>
/* 全局基線:避免 body 預設邊距,讓 LogViewerView 滿版 */
html, body, #log-viewer-app {
  margin: 0;
  padding: 0;
  height: 100%;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI',
  'Microsoft JhengHei', 'PingFang TC', sans-serif;
  background: #f3f4f6;
  color: #1f2937;
}
</style>
