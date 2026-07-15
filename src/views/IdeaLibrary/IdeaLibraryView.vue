<!--
  想法庫(docs/21 §回顧)。主窗頁面:我的 / 部門 + 篩選 + 卡片列表 + 詳情抽屜。
  記錄本身在速記小窗(全域快捷鍵 / 右上「＋ 速記」);本頁只做回顧 / 整理。
-->
<template>
  <div class="idea-lib">
    <!-- 頁首 -->
    <header class="lib-head">
      <div class="head-title">
        <h2>💡 想法庫</h2>
        <span class="head-sub">{{ lib.total.value }} 條想法</span>
      </div>
      <el-button :icon="Plus" round type="primary" @click="openCapture">速記</el-button>
    </header>

    <!-- 工具列:分段 tab + 篩選 -->
    <div class="lib-toolbar">
      <div class="seg">
        <button :class="{on: lib.tab.value === 'my'}" type="button" @click="lib.switchTab('my')">我的</button>
        <button :class="{on: lib.tab.value === 'dept'}" type="button" @click="lib.switchTab('dept')">部門</button>
      </div>
      <div class="filters">
        <el-select v-model="lib.filters.status" clearable placeholder="狀態" size="small" style="width: 108px"
                   @change="lib.applyFilters">
          <el-option v-for="(l, k) in STATUS_LABEL" :key="k" :label="l" :value="k"/>
        </el-select>
        <el-select v-model="lib.filters.ideaType" clearable placeholder="類型" size="small" style="width: 108px"
                   @change="lib.applyFilters">
          <el-option v-for="(l, k) in TYPE_LABEL" :key="k" :label="l" :value="k"/>
        </el-select>
        <el-input v-model="lib.filters.tag" :prefix-icon="Search" clearable placeholder="標籤" size="small"
                  style="width: 150px" @clear="lib.applyFilters" @keyup.enter="lib.applyFilters"/>
      </div>
    </div>

    <!-- 內容 -->
    <div v-loading="lib.loading.value" class="lib-body">
      <el-alert v-if="lib.error.value" :closable="false" :title="lib.error.value" class="lib-error" show-icon
                type="error"/>
      <el-empty v-if="!lib.items.value.length && !lib.loading.value && !lib.error.value"
                description="還沒有想法,按快捷鍵或點「速記」記一條"/>
      <div v-else class="cards">
        <button
            v-for="it in lib.items.value" :key="it.clientId"
            :style="{ '--accent': typeColor(it.ideaType) }"
            class="card" type="button" @click="openDetail(it.clientId)"
        >
          <div class="card-top">
            <span :style="{ background: typeColor(it.ideaType) }" class="type-pill">{{ TYPE_LABEL[it.ideaType] }}</span>
            <span class="grow"/>
            <span v-if="REFINE_LABEL[it.refineStatus]" :class="it.refineStatus" class="ai-badge">
              {{ REFINE_LABEL[it.refineStatus] }}
            </span>
            <span :class="it.status" :title="STATUS_LABEL[it.status]" class="status-dot"/>
          </div>

          <img v-if="it.thumbnailUrl" :src="it.thumbnailUrl" alt="" class="card-thumb" loading="lazy"/>

          <div class="card-title">{{ it.title }}</div>

          <div v-if="it.tags.length" class="card-tags">
            <span v-for="t in it.tags.slice(0, 4)" :key="t" class="tag">#{{ t }}</span>
          </div>

          <div class="card-foot">
            <span>{{ relTime(it.createdAt) }}</span>
            <span v-if="lib.tab.value === 'dept'" class="author">· {{ it.userName }}</span>
          </div>
        </button>
      </div>

      <el-pagination
          v-if="lib.total.value > lib.PAGE_SIZE"
          :current-page="lib.pageIndex.value" :page-size="lib.PAGE_SIZE" :total="lib.total.value"
          background class="lib-pager" layout="prev, pager, next"
          @current-change="lib.goPage"
      />
    </div>

    <IdeaDetailDrawer v-model="drawerOpen" :client-id="activeClientId" @changed="lib.load" @deleted="onDeleted"/>
  </div>
</template>

<script lang="ts" setup>
import {ref} from 'vue'
import {Plus, Search} from '@element-plus/icons-vue'
import type {IdeaType} from '@shared/types/idea-capture.types'
import {
  REFINE_LABEL,
  STATUS_LABEL,
  TYPE_LABEL,
  useIdeaLibrary
} from '@/features/idea-capture/composables/useIdeaLibrary'
import {formatRelative as relTime} from '@/shared/utils/format'
import IdeaDetailDrawer from '@/features/idea-capture/components/IdeaDetailDrawer.vue'

const lib = useIdeaLibrary()

const drawerOpen = ref(false)
const activeClientId = ref('')

function openCapture() {
  window.electronAPI.window.openIdeaCapture().catch(() => {/* 開窗失敗不擴散 */
  })
}

function openDetail(clientId: string) {
  activeClientId.value = clientId
  drawerOpen.value = true
}

function onDeleted() {
  drawerOpen.value = false
  void lib.load()
}

const TYPE_COLOR: Record<IdeaType, string> = {
  improve: '#409eff', issue: '#f56c6c', inspiration: '#e6a23c', todo: '#909399',
}

function typeColor(t: IdeaType): string {
  return TYPE_COLOR[t] ?? '#409eff'
}
</script>

<style scoped>
.idea-lib {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 20px 24px;
  box-sizing: border-box;
}

/* 頁首 */
.lib-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  margin-bottom: 16px;
}

.head-title {
  display: flex;
  align-items: baseline;
  gap: 10px;
}

.head-title h2 {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  color: var(--el-text-color-primary, #303133);
}

.head-sub {
  font-size: 13px;
  color: var(--el-text-color-secondary, #909399);
}

/* 工具列 */
.lib-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}

.seg {
  display: inline-flex;
  background: var(--el-fill-color-light, #f5f7fa);
  border-radius: 9px;
  padding: 3px;
}

.seg button {
  border: none;
  background: transparent;
  padding: 5px 18px;
  border-radius: 7px;
  cursor: pointer;
  font-size: 13px;
  color: var(--el-text-color-secondary, #909399);
  transition: all 0.15s;
}

.seg button.on {
  background: var(--el-bg-color, #fff);
  color: var(--el-color-primary, #409eff);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
  font-weight: 600;
}

.filters {
  display: flex;
  gap: 8px;
}

/* 列表 */
.lib-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  margin: 0 -4px;
  padding: 0 4px;
}

.cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 14px;
}

.card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 8px;
  text-align: left;
  border: 1px solid var(--el-border-color-lighter, #ebeef5);
  border-left: 3px solid var(#409eff);
  border-radius: 12px;
  background: var(--el-bg-color, #fff);
  padding: 14px 16px;
  cursor: pointer;
  transition: transform 0.15s, box-shadow 0.15s, border-color 0.15s;
}

.card:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.08);
}

.card-top {
  display: flex;
  align-items: center;
  gap: 8px;
}

.type-pill {
  color: #fff;
  font-size: 11px;
  font-weight: 600;
  padding: 2px 9px;
  border-radius: 20px;
  line-height: 1.5;
}

.grow {
  flex: 1;
}

.ai-badge {
  font-size: 11px;
  padding: 1px 8px;
  border-radius: 10px;
}

.ai-badge.done {
  color: #626aef;
  background: rgba(98, 106, 239, 0.1);
}

.ai-badge.pending {
  color: #e6a23c;
  background: rgba(230, 162, 60, 0.12);
}

.ai-badge.failed {
  color: #f56c6c;
  background: rgba(245, 108, 108, 0.12);
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.status-dot.inbox {
  background: #e6a23c;
}

.status-dot.accepted {
  background: #409eff;
}

.status-dot.done {
  background: #67c23a;
}

.status-dot.archived {
  background: #c0c4cc;
}

.card-thumb {
  width: 100%;
  height: 110px;
  object-fit: cover;
  border-radius: 8px;
}

.card-title {
  font-weight: 600;
  font-size: 14.5px;
  line-height: 1.45;
  color: var(--el-text-color-primary, #303133);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.card-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.tag {
  font-size: 11px;
  color: var(--el-color-primary, #409eff);
  background: var(--el-color-primary-light-9, #ecf5ff);
  padding: 1px 7px;
  border-radius: 6px;
}

.card-foot {
  display: flex;
  gap: 4px;
  font-size: 12px;
  color: var(--el-text-color-secondary, #909399);
  margin-top: auto;
}

.lib-error {
  margin-bottom: 14px;
}

.lib-pager {
  margin-top: 20px;
  justify-content: center;
}
</style>
