<script lang="ts" setup>
/**
 * 日誌查看器子視窗根組件 — 只裝日誌頁,工作採集已搬回主視窗「個人功能」。
 *
 * 設計取捨:
 *  - 過去這裡是 nav + 多 pane shell(logs / workCollect),那是當初把工作採集
 *    放進密碼保護視窗的設計。現在工作採集回到主視窗的個人功能入口,LogViewer
 *    回到階段一的單純面貌 —— 直接渲染 LogViewerView,不再帶 sidebar。
 *  - 未來真要再加管理員管理頁,可以把 sidebar shell 從 git 歷史拉回來,或在這檔
 *    直接用 router/tab,看屆時需求。目前只有一頁,shell 反而是雜訊。
 *
 * pinia / i18n 仍在 main.ts 掛著(LogViewerView 本身不用,但留著零成本,
 * 未來新增任何需要 store / t() 的子件不必再回頭改 main.ts)。
 */
import LogViewerView from './LogViewerView.vue'
</script>

<template>
  <LogViewerView/>
</template>

<style>
/* 全局基線:避免 body 預設邊距,讓佈局滿版 */
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
