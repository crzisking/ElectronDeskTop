<script setup lang="ts">
/**
 * 工作自動採集 — 主視圖
 *
 * 職責:
 *  1. 顯示 / 切換採集開關(寫進 app-config.json + 啟停主進程 scheduler)
 *  2. 提示採集規則(8:00-17:00 工時內 + 螢幕未鎖才執行)
 *  3. 列出今日採集紀錄(時間軸風格)
 *
 * 採集邏輯本身在主進程 WorkCollectorScheduler 跑,本視圖只是「設定 + 觀察」面板。
 * 進頁時:
 *  - store.bootstrap():把 token + apiBaseUrl 推給主進程 + 訂閱 PUSH_WORK_RECORD_NEW
 *  - store.refresh():載入今日紀錄
 * 主進程寫進新紀錄時會觸發 push,store 自動 refresh,UI 反應式更新。
 */

import {onMounted, computed} from 'vue'
import {useRouter} from 'vue-router'
import {ArrowLeft, Monitor, VideoCamera} from '@element-plus/icons-vue'
import {ElMessage} from 'element-plus'
import {useWorkCollectStore} from '@/stores/work-collect.store'
import type {WorkCategory, WorkRecord} from '@/types/work-record.types'

const router = useRouter()
const store = useWorkCollectStore()

/** 返回上一頁 */
function handleBack() {
  if (window.history.length > 1) router.back()
  else router.push({name: 'internal-functions'})
}

/** 切換採集開關 */
async function onToggleChange(next: boolean) {
  try {
    await store.toggle(next)
    ElMessage.success(next ? '已啟用工作採集' : '已停用工作採集')
  } catch {
    ElMessage.error('切換失敗,請查看日誌')
  }
}

// ── 分類顯示對照表 ───────────────────────────────────────────────
// 跟後端 WorkCategory 列舉一致,前端只負責換成中文標籤 + tag 顏色
const CATEGORY_LABEL: Record<WorkCategory, string> = {
  coding: '編碼',
  documenting: '文件',
  browsing: '瀏覽',
  communicating: '溝通',
  meeting: '會議',
  designing: '設計',
  idle: '閒置',
  other: '其他',
}

const CATEGORY_TAG_TYPE: Record<WorkCategory, 'success' | 'info' | 'warning' | 'danger' | 'primary'> = {
  coding: 'success',
  documenting: 'primary',
  browsing: 'info',
  communicating: 'warning',
  meeting: 'danger',
  designing: 'primary',
  idle: 'info',
  other: 'info',
}

/** 把 Unix ms 格式化為 HH:mm */
function formatTime(ms: number): string {
  const d = new Date(ms)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

/** UI 標題用,顯示「採集時段 08:00-17:00」 */
const workHoursLabel = computed(() => {
  const {start, end} = store.workHours
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(start)}:00 - ${pad(end)}:00`
})

/** 今日紀錄(從 store 鏡像,按時間升序) */
const records = computed<WorkRecord[]>(() => store.records)

onMounted(async () => {
  store.bootstrap()
  await store.refresh()
})
</script>

<template>
  <div class="work-collect-view">
    <!-- ── 頂部:返回 + 標題 ─────────────────────────────────────── -->
    <div class="header">
      <el-button text :icon="ArrowLeft" @click="handleBack">返回</el-button>
      <h2 class="title">
        <el-icon><VideoCamera/></el-icon>
        工作自動採集
      </h2>
    </div>

    <!-- ── 設定卡片:開關 + 規則說明 ─────────────────────────────── -->
    <el-card class="settings-card" shadow="never">
      <div class="setting-row">
        <div class="setting-info">
          <div class="label">啟用採集</div>
          <div class="hint">
            開啟後,主進程每
            <strong>{{ store.intervalMinutes }} 分鐘</strong>
            自動擷取一次螢幕內容並送 AI 分析,結果只存在本機 SQLite,**截圖不落地**。
          </div>
        </div>
        <el-switch
          :model-value="store.enabled"
          @update:model-value="(v: any) => onToggleChange(Boolean(v))"
          size="large"
          inline-prompt
          active-text="ON"
          inactive-text="OFF"
        />
      </div>

      <el-divider/>

      <!-- 採集規則(只讀,改要去 config) -->
      <div class="rules">
        <div class="rule">
          <el-icon><Monitor/></el-icon>
          採集時段:<strong>{{ workHoursLabel }}</strong>(此區間外不採集)
        </div>
        <div class="rule">
          <el-icon><Monitor/></el-icon>
          螢幕鎖定時自動暫停,解鎖後恢復
        </div>
      </div>
    </el-card>

    <!-- ── 今日紀錄時間軸 ────────────────────────────────────────── -->
    <el-card class="records-card" shadow="never" v-loading="store.loading">
      <template #header>
        <span class="records-title">今日採集紀錄</span>
        <span class="records-count">共 {{ records.length }} 筆</span>
      </template>

      <el-empty v-if="!records.length && !store.loading" description="今日尚無紀錄"/>

      <el-timeline v-else>
        <el-timeline-item
          v-for="rec in records"
          :key="rec.id"
          :timestamp="formatTime(rec.capturedAt)"
          placement="top"
        >
          <div class="record-row">
            <el-tag :type="CATEGORY_TAG_TYPE[rec.category]" size="small">
              {{ CATEGORY_LABEL[rec.category] }}
            </el-tag>
            <span class="record-desc">{{ rec.description }}</span>
          </div>
          <div v-if="rec.activeWindowTitle" class="record-meta">
            前台:{{ rec.activeWindowTitle }}
          </div>
        </el-timeline-item>
      </el-timeline>
    </el-card>
  </div>
</template>

<style scoped>
.work-collect-view {
  padding: 24px;
  max-width: 960px;
  margin: 0 auto;
}

.header {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 24px;
}

.title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  font-size: 22px;
  font-weight: 600;
}

.settings-card {
  margin-bottom: 24px;
  border-radius: 12px;
}

.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
}

.setting-info .label {
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 4px;
}

.setting-info .hint {
  font-size: 13px;
  color: var(--el-text-color-secondary);
  line-height: 1.6;
}

.rules {
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 13px;
  color: var(--el-text-color-regular);
}

.rule {
  display: flex;
  align-items: center;
  gap: 6px;
}

.records-card {
  border-radius: 12px;
}

.records-title {
  font-size: 16px;
  font-weight: 600;
}

.records-count {
  margin-left: 12px;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.record-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.record-desc {
  font-size: 14px;
  color: var(--el-text-color-primary);
  line-height: 1.6;
}

.record-meta {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
</style>
