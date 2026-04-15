<script setup lang="ts">
/**
 * RepairDetailDialog — 工單詳情彈窗組件
 *
 * 純 UI 展示組件，不包含任何業務邏輯，所有資料由父層（ITRepairView）傳入。
 *
 * 佈局：
 *  ┌──────────────────────────────────────────┐
 *  │ el-descriptions（工單號、標題、狀態等）    │
 *  │ ─────────────────────────────────────── │
 *  │ 問題描述區塊（富文本 v-html 渲染）         │
 *  │ ─────────────────────────────────────── │
 *  │ 附件圖片網格（支持點擊大圖預覽）           │
 *  ├──────────────────────────────────────────┤
 *  │                              關閉         │
 *  └──────────────────────────────────────────┘
 *
 * Props:
 *  @prop modelValue    {boolean}        彈窗顯示狀態，支持 v-model
 *  @prop loading       {boolean}        是否正在載入詳情資料，true 時顯示 loading 遮罩
 *  @prop detail        {RepairDetail | null} 工單完整詳情，null 時不渲染內容區
 *  @prop previewUrls   {string[]}       所有附件圖片的 URL 列表，傳給 el-image 做大圖輪播
 *  @prop statusLabels  {Record<number, string>}                   狀態碼 → 中文文字
 *  @prop statusTagTypes {Record<number, 'warning'|'primary'|'info'>} 狀態碼 → Tag 顏色
 *
 * Emits:
 *  @emit update:modelValue  點擊關閉按鈕時通知父層更新 visible 狀態
 */

import type { RepairDetail } from '@/types/api.types'

defineProps<{
  modelValue: boolean
  loading: boolean
  detail: RepairDetail | null
  previewUrls: string[]
  statusLabels: Record<number, string>
  statusTagTypes: Record<number, 'warning' | 'primary' | 'info'>
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()
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

        <!-- ── 基本信息表格 ──────────────────────────────────────── -->
        <el-descriptions :column="2" border size="small">
          <!-- 工單號跨兩列，使用等寬字體突出顯示 -->
          <el-descriptions-item label="工單號" :span="2">
            <span class="request-no">{{ detail.requestNo }}</span>
          </el-descriptions-item>

          <!-- 標題跨兩列 -->
          <el-descriptions-item label="標題" :span="2">
            <span class="detail-title">{{ detail.title }}</span>
          </el-descriptions-item>

          <!-- 狀態使用 Tag 顏色化顯示 -->
          <el-descriptions-item label="狀態">
            <el-tag :type="statusTagTypes[detail.status]">
              {{ statusLabels[detail.status] }}
            </el-tag>
          </el-descriptions-item>

          <el-descriptions-item label="提交人">{{ detail.userName }}</el-descriptions-item>
          <el-descriptions-item label="提交時間">{{ detail.createTime }}</el-descriptions-item>
          <el-descriptions-item label="處理人">
            {{ detail.assignedName ?? '待分配' }}
          </el-descriptions-item>

          <!-- 分配時間和分配操作人：僅狀態為「已分配/已關閉」時後端才返回，條件渲染 -->
          <template v-if="detail.assignTime">
            <el-descriptions-item label="分配時間">{{ detail.assignTime }}</el-descriptions-item>
            <el-descriptions-item label="分配操作人">
              {{ detail.assignerName ?? '-' }}
            </el-descriptions-item>
          </template>
        </el-descriptions>

        <!-- ── 問題描述（富文本） ────────────────────────────────── -->
        <!-- 使用 v-html 渲染後端存儲的富文本 HTML，包含文字格式和圖片 -->
        <div class="description-section">
          <div class="description-section-title">問題描述</div>
          <div class="description-text" v-html="detail.description"></div>
        </div>

        <!-- ── 附件圖片網格 ──────────────────────────────────────── -->
        <!-- 僅在有附件時渲染，避免顯示空的標題行 -->
        <template v-if="detail.attachments.length > 0">
          <div class="attachments-title">
            附件圖片（{{ detail.attachments.length }} 張）
          </div>
          <div class="attachments-grid">
            <!--
              el-image 的大圖預覽通過 :preview-src-list 和 :initial-index 實現：
              - preview-src-list 傳入所有圖片 URL，點擊任意圖片後可左右切換
              - initial-index 設為當前索引，確保點哪張從哪張開始預覽
            -->
            <el-image
              v-for="(att, idx) in detail.attachments"
              :key="idx"
              :src="att.fileUrl"
              :preview-src-list="previewUrls"
              :initial-index="idx"
              fit="cover"
              class="attachment-thumb"
            >
              <!-- 圖片載入失敗時顯示錯誤佔位 -->
              <template #error>
                <div class="attachment-error">載入失敗</div>
              </template>
            </el-image>
          </div>
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

/* 問題描述區塊：帶標題欄的卡片式容器 */
.description-section {
  margin-top: 16px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  overflow: hidden;
}

/* 描述區塊標題欄：淺灰背景區分標題與內容 */
.description-section-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--el-text-color-regular);
  padding: 8px 12px;
  background: var(--el-fill-color-lighter);
  border-bottom: 1px solid var(--el-border-color-lighter);
}

/* 富文本內容區：內邊距 + 適中行高保證可讀性 */
.description-text {
  padding: 12px;
  line-height: 1.6;
  word-break: break-all;
}

/* 富文本段落間距：最後一個段落不加底部間距 */
.description-text :deep(p) { margin: 0 0 8px; }
.description-text :deep(p:last-child) { margin-bottom: 0; }

/* 富文本中的圖片：塊級顯示 + 限制最大寬度 + 圓角 */
.description-text :deep(img) {
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

/* 附件圖片網格：flex 換行排列 */
.attachments-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

/* 縮略圖：固定尺寸 + 放大鏡鼠標提示點擊可預覽 */
.attachment-thumb {
  width: 100px;
  height: 100px;
  border-radius: 6px;
  border: 1px solid var(--el-border-color-lighter);
  cursor: zoom-in;
}

/* 圖片載入失敗的佔位區域 */
.attachment-error {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  color: var(--el-text-color-placeholder);
  background: var(--el-fill-color-lighter);
}
</style>
