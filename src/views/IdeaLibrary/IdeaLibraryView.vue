<!--
  想法庫(docs/21 §回顧)。主窗頁面:我的 / 部門 tab + 篩選 + 卡片列表 + 詳情抽屜。
  記錄本身在速記小窗(全域快捷鍵 / 右上「＋ 速記」);本頁只做回顧 / 整理。
-->
<template>
  <div class="idea-lib">
    <header class="lib-head">
      <el-tabs v-model="lib.tab.value" class="lib-tabs" @tab-change="onTabChange">
        <el-tab-pane label="我的" name="my"/>
        <el-tab-pane label="部門" name="dept"/>
      </el-tabs>
      <el-button :icon="Plus" type="primary" @click="openCapture">速記</el-button>
    </header>

    <div class="lib-filters">
      <el-select v-model="lib.filters.status" clearable placeholder="狀態" style="width: 120px"
                 @change="lib.applyFilters">
        <el-option v-for="(l, k) in STATUS_LABEL" :key="k" :label="l" :value="k"/>
      </el-select>
      <el-select v-model="lib.filters.ideaType" clearable placeholder="類型" style="width: 120px"
                 @change="lib.applyFilters">
        <el-option v-for="(l, k) in TYPE_LABEL" :key="k" :label="l" :value="k"/>
      </el-select>
      <el-input
          v-model="lib.filters.tag" clearable placeholder="標籤" style="width: 160px"
          @clear="lib.applyFilters" @keyup.enter="lib.applyFilters"
      />
    </div>

    <div v-loading="lib.loading.value" class="lib-body">
      <el-empty v-if="!lib.items.value.length && !lib.loading.value" description="還沒有想法"/>
      <div v-else class="cards">
        <button
            v-for="it in lib.items.value" :key="it.clientId"
            class="card" type="button" @click="openDetail(it.clientId)"
        >
          <div class="card-badges">
            <el-tag size="small" type="info">{{ TYPE_LABEL[it.ideaType] }}</el-tag>
            <el-tag :type="statusTagType(it.status)" size="small">{{ STATUS_LABEL[it.status] }}</el-tag>
            <el-tag v-if="REFINE_LABEL[it.refineStatus]" effect="plain" size="small">{{
                REFINE_LABEL[it.refineStatus]
              }}
            </el-tag>
          </div>
          <img v-if="thumbs[it.clientId]" :src="thumbs[it.clientId]" alt="" class="card-thumb"/>
          <div class="card-title">{{ it.title }}</div>
          <div v-if="it.tags.length" class="card-tags">
            <span v-for="t in it.tags" :key="t" class="mini-tag">#{{ t }}</span>
          </div>
          <div class="card-meta">{{ formatTime(it.createdAt) }} · {{ it.userName }}</div>
        </button>
      </div>

      <el-pagination
          v-if="lib.total.value > lib.PAGE_SIZE"
          :current-page="lib.pageIndex.value" :page-size="lib.PAGE_SIZE" :total="lib.total.value"
          background class="lib-pager" layout="prev, pager, next"
          @current-change="lib.goPage"
      />
    </div>

    <IdeaDetailDrawer
        v-model="drawerOpen" :client-id="activeClientId"
        @changed="lib.load" @deleted="onDeleted"
    />
  </div>
</template>

<script lang="ts" setup>
import {ref, watch} from 'vue'
import {Plus} from '@element-plus/icons-vue'
import type {IdeaStatus} from '@shared/types/idea-capture.types'
import {
  REFINE_LABEL,
  STATUS_LABEL,
  TYPE_LABEL,
  useIdeaLibrary
} from '@/features/idea-capture/composables/useIdeaLibrary'
import {ideaLibraryApi} from '@/features/idea-capture/api'
import IdeaDetailDrawer from '@/features/idea-capture/components/IdeaDetailDrawer.vue'

const lib = useIdeaLibrary()

const drawerOpen = ref(false)
const activeClientId = ref('')
/** clientId → 縮略圖 dataURL(主進程代拉;memo 快取) */
const thumbs = ref<Record<string, string>>({})

function onTabChange() {
  lib.pageIndex.value = 1
  void lib.load()
}

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

function statusTagType(s: IdeaStatus): 'info' | 'success' | 'warning' | 'primary' {
  return s === 'done' ? 'success' : s === 'accepted' ? 'primary' : s === 'archived' ? 'info' : 'warning'
}

function formatTime(ms: number): string {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

// 懶拉縮略圖:列表回來後,對有 thumbnailUrl 的卡逐一代拉(避開 CSP)
async function loadThumbs() {
  for (const it of lib.items.value) {
    if (!it.thumbnailUrl || thumbs.value[it.clientId]) continue
    try {
      thumbs.value[it.clientId] = await ideaLibraryApi.getAttachment(it.thumbnailUrl)
    } catch {/* 縮略圖失敗不影響列表 */
    }
  }
}

// items 變了就補縮略圖
watch(() => lib.items.value, loadThumbs, {deep: false})
</script>

<style scoped>
.idea-lib {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 16px 20px;
  box-sizing: border-box;
}

.lib-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.lib-tabs {
  flex: 1;
}

.lib-filters {
  display: flex;
  gap: 8px;
  margin: 4px 0 12px;
}

.lib-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 12px;
}

.card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  text-align: left;
  border: 1px solid var(--el-border-color, #e4e7ed);
  border-radius: 10px;
  background: var(--el-bg-color, #fff);
  padding: 12px;
  cursor: pointer;
  transition: box-shadow 0.15s, border-color 0.15s;
}

.card:hover {
  border-color: var(--el-color-primary, #409eff);
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06);
}

.card-badges {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}

.card-thumb {
  width: 100%;
  height: 96px;
  object-fit: cover;
  border-radius: 6px;
}

.card-title {
  font-weight: 600;
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.card-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.mini-tag {
  font-size: 11px;
  color: var(--el-color-primary, #409eff);
}

.card-meta {
  font-size: 12px;
  color: var(--el-text-color-secondary, #909399);
}

.lib-pager {
  margin-top: 16px;
  justify-content: center;
}
</style>
