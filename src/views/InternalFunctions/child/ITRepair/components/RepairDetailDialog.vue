<script setup lang="ts">
/**
 * RepairDetailDialog — 工單詳情彈窗組件
 *
 * 純 UI 展示組件，不包含任何業務邏輯，所有資料由父層（ITRepairView）傳入。
 *
 * 對應接口：GET /api/repair/user-report/{id}（RepairUserReportResponse）
 *
 * 佈局：
 *  ┌──────────────────────────────────────────┐
 *  │ 提問信息（工單號、標題、提交人、提交時間） │
 *  │ ─────────────────────────────────────── │
 *  │ 問題描述（富文本 v-html 渲染）             │
 *  │ ─────────────────────────────────────── │
 *  │ IT 匯報回覆（未匯報時顯示占位提示）        │
 *  │ ─────────────────────────────────────── │
 *  │ 匯報附件（文件名列表，點擊由瀏覽器打開）    │
 *  ├──────────────────────────────────────────┤
 *  │                              關閉         │
 *  └──────────────────────────────────────────┘
 *
 * Props:
 *  @prop modelValue    {boolean}               彈窗顯示狀態，支持 v-model
 *  @prop loading       {boolean}               是否正在載入詳情資料，true 時顯示 loading 遮罩
 *  @prop detail        {RepairDetail | null}   工單完整詳情，null 時不渲染內容區
 *
 * Emits:
 *  @emit update:modelValue  點擊關閉按鈕時通知父層更新 visible 狀態
 */

import { Document } from '@element-plus/icons-vue'
import type { RepairDetail, RepairResultAttachment } from '@/types/api.types'

defineProps<{
  modelValue: boolean
  loading: boolean
  detail: RepairDetail | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

/**
 * 顯示附件名稱：優先用後端返回的 fileName；
 * 若缺失則回退到 URL 末段（去掉 query string），再 decode 處理轉義字符。
 */
function attachmentLabel(att: RepairResultAttachment): string {
  if (att.fileName) return att.fileName
  const last = att.fileUrl.split('?')[0].split('/').pop() ?? att.fileUrl
  try {
    return decodeURIComponent(last)
  } catch {
    return last
  }
}
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    title="工單詳情"
    width="640px"
    :close-on-click-modal="false"
    destroy-on-close
    @update:model-value="emit('update:modelValue', $event)"
  >
    <!-- v-loading：detail 請求進行中時顯示載入遮罩 -->
    <div v-loading="loading" class="detail-content">
      <!-- detail 為 null（載入中或失敗）時不渲染任何內容 -->
      <template v-if="detail">

        <!-- ── 提問信息 ──────────────────────────────────────────── -->
        <el-descriptions :column="2" border size="small">
          <!-- 工單號跨兩列，使用等寬字體突出顯示 -->
          <el-descriptions-item label="工單號" :span="2">
            <span class="request-no">{{ detail.requestNo }}</span>
          </el-descriptions-item>

          <!-- 標題跨兩列 -->
          <el-descriptions-item label="標題" :span="2">
            <span class="detail-title">{{ detail.title }}</span>
          </el-descriptions-item>

          <el-descriptions-item label="提交人">{{ detail.userName }}</el-descriptions-item>
          <el-descriptions-item label="提交時間">{{ detail.createTime }}</el-descriptions-item>
        </el-descriptions>

        <!-- ── 問題描述（富文本） ────────────────────────────────── -->
        <!-- 使用 v-html 渲染後端存儲的富文本 HTML，包含文字格式和圖片 -->
        <div class="section">
          <div class="section-title">問題描述</div>
          <div class="section-body rich-text" v-html="detail.description"></div>
        </div>

        <!-- ── IT 匯報回覆（富文本） ─────────────────────────────── -->
        <!--
          resultContent 為 null 時表示 IT 尚未提交用戶可見匯報（IsUserSee=1 那一筆）。
          此時顯示占位提示，不渲染富文本區。
        -->
        <div class="section">
          <div class="section-title report-title">
            <span>IT 匯報回覆</span>
            <span v-if="detail.resultTime" class="report-time">
              {{ detail.resultTime }}
            </span>
          </div>
          <div v-if="detail.resultContent" class="section-body rich-text" v-html="detail.resultContent"></div>
          <div v-else class="section-body section-empty">
            IT 尚未提交匯報回覆
          </div>
        </div>

        <!-- ── 匯報附件 ──────────────────────────────────────────── -->
        <!--
          後端返回的附件為 OSS URL，可能是任意文件類型（圖片、文檔、壓縮包…），
          此處不做類型判斷，統一以文件名列表形式呈現。
          target="_blank" + rel=noopener：點擊以系統默認瀏覽器新標籤頁打開，
          圖片/PDF 等瀏覽器可預覽的直接預覽，其他格式觸發下載。
        -->
        <template v-if="detail.attachments.length > 0">
          <div class="attachments-title">
            匯報附件（{{ detail.attachments.length }} 個）
          </div>
          <ul class="attachments-list">
            <li
              v-for="(att, idx) in detail.attachments"
              :key="att.id ?? idx"
              class="attachments-item"
            >
              <a
                :href="att.fileUrl"
                target="_blank"
                rel="noopener noreferrer"
                class="attachment-link"
              >
                <el-icon class="attachment-icon"><Document /></el-icon>
                <span class="attachment-name">{{ attachmentLabel(att) }}</span>
              </a>
            </li>
          </ul>
        </template>

      </template>
    </div>

    <template #footer>
      <el-button @click="emit('update:modelValue', false)">關閉</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
/* 詳情容器：設置最小高度，防止載入中時彈窗高度塌陷 */
.detail-content {
  min-height: 100px;
}

/* 工單號：等寬字體讓長字串對齊更整齊，主色突出 */
.request-no {
  font-family: monospace;
  font-weight: 600;
  color: var(--el-color-primary);
}

/* 標題：加粗顯示 */
.detail-title {
  font-weight: 600;
  color: var(--el-text-color-primary);
  font-size: 14px;
}

/* 區塊：帶標題欄的卡片式容器 */
.section {
  margin-top: 16px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  overflow: hidden;
}

/* 區塊標題欄：淺灰背景區分標題與內容 */
.section-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--el-text-color-regular);
  padding: 8px 12px;
  background: var(--el-fill-color-lighter);
  border-bottom: 1px solid var(--el-border-color-lighter);
}

/* 匯報標題欄：左標題 + 右時間 */
.report-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.report-time {
  font-size: 12px;
  font-weight: 400;
  color: var(--el-text-color-secondary);
}

/* 區塊內容區 */
.section-body {
  padding: 12px;
  line-height: 1.6;
  word-break: break-all;
}

/* 尚未匯報占位 */
.section-empty {
  color: var(--el-text-color-placeholder);
  font-style: italic;
  text-align: center;
  padding: 18px 12px;
}

/* 富文本內容：段落間距與圖片樣式 */
.rich-text :deep(p) { margin: 0 0 8px; }
.rich-text :deep(p:last-child) { margin-bottom: 0; }
.rich-text :deep(img) {
  display: block;
  max-width: 100%;
  height: auto;
  margin-top: 8px;
  border-radius: 6px;
}

/* 附件標題 */
.attachments-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  margin: 16px 0 10px;
}

/* 附件列表：無默認項目符號，緊湊垂直排列 */
.attachments-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.attachments-item {
  margin: 0;
}

/* 附件鏈接：icon + 文件名，整行 hover 高亮 */
.attachment-link {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  background: var(--el-fill-color-lighter);
  color: var(--el-color-primary);
  text-decoration: none;
  font-size: 13px;
  transition: all 0.15s;
}

.attachment-link:hover {
  background: var(--el-color-primary-light-9);
  border-color: var(--el-color-primary-light-5);
}

.attachment-icon {
  flex-shrink: 0;
  font-size: 16px;
}

.attachment-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
