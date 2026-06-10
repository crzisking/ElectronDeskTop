<script lang="ts" setup>
/**
 * 備忘錄子視窗根組件 — 直接渲染 MemosView。
 *
 * 跟主窗共用同一個 MemosView 組件實作(`src/features/project-flow/MemosView.vue`),
 * 透過 import 復用,避免兩份程式碼分叉。
 *
 * 跟主窗的差異 — MemosView 內部呼叫的 `projectFlowApi`(`src/features/project-flow/api.ts`)
 * 從 `useAuthStore().user.userName` 取 userId 拼 ctx;子窗的 authStore 是獨立空 store。
 * 但主進程 IPC handler 已加 fallback:`ctx` 缺 userId 時走 main 進程的 authContext
 * (主窗登入時推進去的單例),所以子窗即便沒登入過,也能拿到主窗共享的身分。
 */
import MemosView from '@/features/project-flow/MemosView.vue'
</script>

<template>
  <MemosView/>
</template>

<style>
html, body, #memos-app {
  margin: 0;
  padding: 0;
  height: 100%;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI',
  'Microsoft JhengHei', 'PingFang TC', sans-serif;
  background: #fafbfc;
  color: #1f2937;
}
</style>
