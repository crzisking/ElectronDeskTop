<script setup lang="ts">
/**
 * 業務安排與尋找 — 主頁面
 *
 * ── 頁面結構 ──────────────────────────────────────────────────────────
 * 首頁展示兩個功能入口卡片：
 *  1. 維護業務流水線 — 使用 Vue Flow 流程圖編輯器管理業務流程
 *  2. 尋找業務負責人 — 搜索查找業務對應的負責人員
 *
 * 點擊卡片後切換到對應子頁面（組件內切換，非路由跳轉），
 * 頂部顯示返回按鈕可回到功能選擇頁。
 *
 * ── 子頁面說明 ────────────────────────────────────────────────────────
 * PipelineEditor：流水線編輯器，整合 VueFlowChart 組件
 * BusinessOwnerSearch：業務負責人搜索，支持關鍵詞查找
 */

import { ref } from 'vue'
import PipelineEditor from "@/views/Business/PipelineEditor.vue";
import {ArrowLeft, ArrowRight, DataLine, Search} from "@element-plus/icons-vue";
import BusinessOwnerSearch from "@/views/Business/BusinessOwnerSearch.vue";


/**
 * 當前激活的子頁面
 * 'home'     ：功能選擇首頁（兩張卡片）
 * 'pipeline' ：維護業務流水線
 * 'search'   ：尋找業務負責人
 */
const activeView = ref<'home' | 'pipeline' | 'search'>('home')

/** 切換到指定子頁面 */
function navigateTo(view: 'pipeline' | 'search') {
  activeView.value = view
}

/** 返回功能選擇首頁 */
function goHome() {
  activeView.value = 'home'
}
</script>

<template>
  <div class="app-page business-view">
    <!-- ═══ 功能選擇首頁 ═══ -->
    <template v-if="activeView === 'home'">
      <!-- 功能入口卡片 -->
      <div class="feature-cards">
        <!-- 卡片 1：維護業務流水線 -->
        <div class="feature-card" @click="navigateTo('pipeline')">
          <div class="feature-icon pipeline-icon">
            <el-icon :size="36"><DataLine /></el-icon>
          </div>
          <div class="feature-info">
            <h3 class="feature-title">維護業務流水線</h3>
            <p class="feature-desc">
              使用可視化流程圖編輯器，創建和管理業務流程。
              支持節點拖拽、連線、編輯，所見即所得。
            </p>
          </div>
          <el-icon class="feature-arrow"><ArrowRight /></el-icon>
        </div>

        <!-- 卡片 2：尋找業務負責人 -->
        <div class="feature-card" @click="navigateTo('search')">
          <div class="feature-icon search-icon">
            <el-icon :size="36"><Search /></el-icon>
          </div>
          <div class="feature-info">
            <h3 class="feature-title">尋找業務負責人</h3>
            <p class="feature-desc">
              輸入業務關鍵詞，快速查找負責該業務的人員。
              支持按部門、職責範圍搜索。
            </p>
          </div>
          <el-icon class="feature-arrow"><ArrowRight /></el-icon>
        </div>
      </div>
    </template>

    <!-- ═══ 維護業務流水線子頁面 ═══ -->
    <template v-else-if="activeView === 'pipeline'">
      <div class="sub-page-header">
        <el-button text @click="goHome">
          <el-icon><ArrowLeft /></el-icon>
          返回
        </el-button>
        <span class="sub-page-title">維護業務流水線</span>
      </div>
      <PipelineEditor />
    </template>

    <!-- ═══ 尋找業務負責人子頁面 ═══ -->
    <template v-else-if="activeView === 'search'">
      <div class="sub-page-header">
        <el-button text @click="goHome">
          <el-icon><ArrowLeft /></el-icon>
          返回
        </el-button>
        <span class="sub-page-title">尋找業務負責人</span>
      </div>
      <BusinessOwnerSearch />
    </template>
  </div>
</template>

<style scoped>
.business-view {
  /* 繼承 .app-page 的 padding/gap */
}

/* ── 功能卡片 ──────────────────────────────────────────────── */
.feature-cards {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.feature-card {
  display: flex;
  align-items: center;
  gap: 22px;
  padding: 26px;
  background: var(--app-bg-surface);
  border: 1px solid var(--app-border-subtle);
  border-radius: var(--app-radius-lg);
  box-shadow: var(--app-shadow-sm);
  cursor: pointer;
  transition: box-shadow 0.25s ease, transform 0.25s ease, border-color 0.25s ease;
}

.feature-card:hover {
  border-color: var(--app-border-default);
  box-shadow: var(--app-shadow-card-hover);
  transform: translateY(-2px);
}

.feature-icon {
  width: 64px;
  height: 64px;
  border-radius: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  background: var(--app-bg-elevated);
  color: var(--app-text-primary);
}

.pipeline-icon {
  background: #f0eee9;
}

.search-icon {
  background: #f6e7d0;
  color: var(--app-accent);
}

.feature-info {
  flex: 1;
  min-width: 0;
}

.feature-title {
  font-size: 17px;
  font-weight: 600;
  color: var(--app-text-primary);
  margin: 0 0 6px;
  letter-spacing: -0.005em;
}

.feature-desc {
  font-size: 13px;
  color: var(--app-text-secondary);
  margin: 0;
  line-height: 1.6;
}

.feature-arrow {
  color: var(--app-text-muted);
  font-size: 20px;
  flex-shrink: 0;
  transition: color 0.2s ease, transform 0.2s ease;
}

.feature-card:hover .feature-arrow {
  color: var(--app-text-primary);
  transform: translateX(2px);
}

/* ── 子頁面頂部 ───────────────────────────────────────────── */
.sub-page-header {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
}

.sub-page-title {
  font-size: 18px;
  font-weight: 600;
  color: var(--app-text-primary);
}
</style>
