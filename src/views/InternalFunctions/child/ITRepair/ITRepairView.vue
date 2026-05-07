<script setup lang="ts">
/**
 * IT 報修主視圖
 *
 * 職責：組裝子模塊，處理跨模塊協作邏輯（提交成功後切換 Tab）。
 * 業務邏輯已分離至：
 *  - composables/useRepairSubmit   表單、富文本編輯器、圖片上傳、AI 潤色
 *  - composables/useRepairTickets  工單列表、分頁篩選、詳情載入
 *  - components/RepairPolishDialog AI 整理彈窗 UI
 *  - components/RepairDetailDialog 工單詳情彈窗 UI
 */
import {ref} from 'vue'
import {useRouter} from 'vue-router'
import {useI18n} from 'vue-i18n'
import {QuillEditor} from '@vueup/vue-quill'
import '@vueup/vue-quill/dist/vue-quill.snow.css'
import {ArrowLeft, MagicStick, View} from '@element-plus/icons-vue'
import {useRepairSubmit} from './composables/useRepairSubmit'
import {STATUS_LABELS, STATUS_TAG_TYPES, useRepairTickets} from './composables/useRepairTickets'
import RepairPolishDialog from './components/RepairPolishDialog.vue'
import RepairDetailDialog from './components/RepairDetailDialog.vue'

const router = useRouter()
const {t} = useI18n()

/**
 * 返回上一個頁面：優先使用瀏覽器歷史記錄；
 * 當此頁為 session 首個路由（歷史為空）時，回退到內部功能首頁，
 * 避免點擊返回後停在空白路由或外部頁面。
 */
function handleBack() {
  if (window.history.length > 1) {
    router.back()
  } else {
    router.push({ name: 'internal-functions' })
  }
}

/** 當前激活的 Tab，控制 el-tabs 顯示哪個面板 */
const activeTab = ref<'submit' | 'tickets'>('submit')

// ── 工單列表 Composable ───────────────────────────────────────────
// 先初始化 tickets，因為 onSubmitSuccess 需要引用其中的 ticketParams / loadTickets
const {
  ticketsLoading, tickets, ticketsTotal, ticketParams, loadTickets,
  handleStatusFilter, handlePageChange,
  detailVisible, detailLoading, currentDetail, handleRowClick,
} = useRepairTickets()

/**
 * 跨模塊回調：工單提交成功後由 useRepairSubmit 調用。
 * 負責切換到「我的工單」Tab 並重置到第一頁刷新列表。
 * 定義在兩個 composable 初始化之間，用於解耦 submit 和 tickets 模塊。
 */
async function onSubmitSuccess() {
  activeTab.value = 'tickets'
  ticketParams.pageIndex = 1
  await loadTickets()
}

// ── 提交表單 Composable ───────────────────────────────────────────
// 傳入 onSubmitSuccess 回調，提交完成後由 composable 內部調用
const {
  submitFormRef, submitForm, quillEditorRef, richSubmitRules, descriptionWordCount,
  uploading, submitting, handleEditorReady, handleEditorBlur, handleSubmit, getPlainText,
  POLISH_LIMIT, polishVisible, polishLoading, polishResult, polishUsedCount, polishLimitReached,
  polishDescription, applyPolish, closePolish,
} = useRepairSubmit(onSubmitSuccess)

/**
 * Tab 切換事件處理：切換到「我的工單」且尚未載入過時自動觸發首次載入。
 * 使用 hasLoaded 標記而非 tickets.length === 0 判斷，
 * 避免用戶刪除所有工單後切換 Tab 重複觸發載入。
 */
const ticketsHasLoaded = ref(false)

function onTabChange(name: string | number) {
  if (name === 'tickets' && !ticketsHasLoaded.value) {
    ticketsHasLoaded.value = true
    loadTickets()
  }
}
</script>

<template>
  <div class="app-page it-repair-view">
    <!-- 頁面頭部：僅返回按鈕 -->
    <div class="app-page-header app-page-header--compact">
      <div class="header-row">
        <!-- 原文 tooltip/aria：返回 -->
        <el-tooltip :content="t('repair.back')" placement="bottom">
          <button class="app-icon-btn" :aria-label="t('repair.back')" @click="handleBack">
            <el-icon :size="16"><ArrowLeft /></el-icon>
          </button>
        </el-tooltip>
      </div>
    </div>

    <!-- 主體 Tab -->
    <el-tabs v-model="activeTab" class="repair-tabs" @tab-change="onTabChange">

      <!-- ── 提交報修 Tab ──────────────────────────────────────── -->
      <!-- 原文：提交報修 -->
      <el-tab-pane :label="t('repair.tabSubmit')" name="submit">
        <el-form
          ref="submitFormRef"
          :model="submitForm"
          :rules="richSubmitRules"
          label-position="top"
          class="submit-form"
        >
          <!-- 工單標題 -->
          <!-- 原文 label：工單標題；placeholder：請簡短描述問題，例如：電腦無法開機 -->
          <el-form-item :label="t('repair.fieldTitle')" prop="title">
            <el-input
              v-model="submitForm.title"
              :placeholder="t('repair.fieldTitlePlaceholder')"
              maxlength="100"
              show-word-limit
              clearable
            />
          </el-form-item>

          <!-- 問題描述 + AI 整理 -->
          <el-form-item prop="description">
            <template #label>
              <span class="desc-label-row">
                <!-- 原文：問題描述 -->
                <span>{{ t('repair.fieldDesc') }}</span>
                <!-- 原文 tooltip 已達 N 次上限 / 剩餘 N 次；按鈕：使用AI整理 -->
                <el-tooltip
                  :content="polishLimitReached
                    ? t('repair.polishLimitReached', {limit: POLISH_LIMIT})
                    : t('repair.polishRemaining', {n: POLISH_LIMIT - polishUsedCount})"
                  placement="top"
                >
                  <el-button
                    link
                    :type="polishLimitReached ? 'info' : 'primary'"
                    size="small"
                    :loading="polishLoading"
                    :disabled="polishLimitReached"
                    @click="polishDescription"
                  >
                    <el-icon v-if="!polishLoading"><MagicStick /></el-icon>
                    {{ t('repair.polishBtn') }}
                    <span v-if="polishUsedCount > 0" class="polish-count">
                      {{ polishUsedCount }}/{{ POLISH_LIMIT }}
                    </span>
                  </el-button>
                </el-tooltip>
              </span>
            </template>
            <div class="editor-wrapper">
              <QuillEditor
                ref="quillEditorRef"
                v-model:content="submitForm.description"
                content-type="html"
                theme="snow"
                :toolbar="[]"
                class="repair-editor"
                @ready="handleEditorReady"
                @blur="handleEditorBlur"
              />
              <!-- 原文 tip：Type normally or paste an image directly into the editor（本身已是英文，保持不變） -->
              <div class="editor-footer">
                <span class="editor-tip">{{ t('repair.editorTip') }}</span>
                <span class="editor-count">{{ descriptionWordCount }}/2000</span>
              </div>
            </div>
          </el-form-item>

          <!-- 提交按鈕 -->
          <!-- 原文：提交中... / 提交報修；hint：請等待圖片上傳完成 -->
          <el-form-item>
            <el-button
              type="primary"
              size="large"
              :loading="submitting"
              :disabled="uploading"
              style="min-width: 140px"
              @click="handleSubmit"
            >
              {{ submitting ? t('repair.submitting') : t('repair.submitBtn') }}
            </el-button>
            <span v-if="uploading" class="submit-disabled-hint">{{ t('repair.uploadingHint') }}</span>
          </el-form-item>
        </el-form>
      </el-tab-pane>

      <!-- ── 我的工單 Tab ──────────────────────────────────────── -->
      <!-- 原文：我的工單 -->
      <el-tab-pane :label="t('repair.tabHistory')" name="tickets">
        <!-- 原文 radios：全部 / 已提交 / 已分配 / 已關閉；button：刷新 -->
        <div class="tickets-toolbar">
          <el-radio-group v-model="ticketParams.status" @change="handleStatusFilter">
            <el-radio-button :value="0">{{ t('repair.statusFilterAll') }}</el-radio-button>
            <el-radio-button :value="1">{{ t('repair.statusSubmitted') }}</el-radio-button>
            <el-radio-button :value="2">{{ t('repair.statusAssigned') }}</el-radio-button>
            <el-radio-button :value="3">{{ t('repair.statusClosed') }}</el-radio-button>
          </el-radio-group>
          <el-button :loading="ticketsLoading" @click="loadTickets">{{ t('repair.refresh') }}</el-button>
        </div>

        <!-- 原文 table headers：工單號 / 標題 / 狀態 / 處理人（待分配） / 提交時間 / 操作 / 詳情 -->
        <!-- 原文 empty：暫無工單記錄 -->
        <el-table
          :data="tickets"
          v-loading="ticketsLoading"
          row-class-name="clickable-row"
          :empty-text="t('repair.tableEmpty')"
          style="width: 100%"
          @row-click="handleRowClick"
        >
          <el-table-column prop="requestNo" :label="t('repair.colTicketNo')" width="180" show-overflow-tooltip />
          <el-table-column prop="title" :label="t('repair.colTitle')" min-width="120" show-overflow-tooltip />
          <el-table-column :label="t('repair.colStatus')" width="100">
            <template #default="{ row }">
              <el-tag :type="STATUS_TAG_TYPES[row.status]" size="small">
                {{ t(STATUS_LABELS[row.status]) }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="assignedName" :label="t('repair.colAssigned')" width="120">
            <template #default="{ row }">{{ row.assignedName ?? t('repair.unassigned') }}</template>
          </el-table-column>
          <el-table-column prop="createTime" :label="t('repair.colSubmitTime')" width="170" />
          <el-table-column :label="t('repair.colAction')" width="80" align="center">
            <template #default="{ row }">
              <el-button link type="primary" size="small" @click.stop="handleRowClick(row)">
                <el-icon><View /></el-icon>
                {{ t('repair.viewDetail') }}
              </el-button>
            </template>
          </el-table-column>
        </el-table>

        <el-pagination
          v-if="ticketsTotal > ticketParams.pageSize"
          v-model:current-page="ticketParams.pageIndex"
          :page-size="ticketParams.pageSize"
          :total="ticketsTotal"
          layout="total, prev, pager, next"
          class="tickets-pagination"
          @current-change="handlePageChange"
        />

        <!-- 原文：您還沒有提交過工單 -->
        <el-empty
          v-if="!ticketsLoading && tickets.length === 0"
          :description="t('repair.emptyMyTickets')"
          :image-size="100"
        />
      </el-tab-pane>
    </el-tabs>

    <!-- ── 工單詳情彈窗 ────────────────────────────────────────── -->
    <RepairDetailDialog
      v-model="detailVisible"
      :loading="detailLoading"
      :detail="currentDetail"
    />

    <!-- ── AI 潤色彈窗 ────────────────────────────────────────── -->
    <RepairPolishDialog
      v-model="polishVisible"
      :loading="polishLoading"
      :original-text="getPlainText(submitForm.description)"
      :result="polishResult"
      @update:result="polishResult = $event"
      @apply="applyPolish"
      @close="closePolish"
    />
  </div>
</template>

<style scoped>
.it-repair-view {
  /* 繼承 .app-page 的 padding/gap */
}

.header-row {
  display: flex;
  align-items: center;
  gap: 14px;
}

.repair-tabs {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.repair-tabs :deep(.el-tabs__content) {
  flex: 1;
  overflow-y: auto;
  padding: 20px 4px 4px;
}

.submit-form { max-width: 720px; }

.editor-wrapper {
  width: 100%;
  border: 1px solid var(--el-border-color);
  border-radius: 6px;
  overflow: hidden;
  background: var(--el-bg-color);
}

.editor-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 12px;
  border-top: 1px solid var(--el-border-color-lighter);
  font-size: 12px;
  color: var(--el-text-color-placeholder);
}

.editor-tip { line-height: 1.4; }
.editor-count { flex-shrink: 0; }

.submit-disabled-hint {
  margin-left: 12px;
  font-size: 12px;
  color: var(--el-text-color-placeholder);
}

.desc-label-row {
  display: inline-flex;
  align-items: center;
  gap: 10px;
}

.polish-count {
  font-size: 11px;
  opacity: 0.7;
  margin-left: 2px;
}

.tickets-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
}

.tickets-pagination {
  margin-top: 16px;
  justify-content: flex-end;
}

.it-repair-view :deep(.clickable-row) { cursor: pointer; }

.it-repair-view :deep(.clickable-row:hover > td) {
  background-color: var(--el-fill-color-light) !important;
}
</style>

<!-- Quill 由 JS 動態建立 DOM，scoped :deep() 無法命中，需用全域樣式覆蓋 -->
<style>
.repair-editor .ql-toolbar,
.repair-editor .ql-toolbar.ql-snow {
  display: none !important;
  height: 0 !important;
  min-height: 0 !important;
  padding: 0 !important;
  margin: 0 !important;
  border: none !important;
  overflow: hidden !important;
}

.repair-editor .ql-container.ql-snow { border: 0 !important; }

.repair-editor .ql-editor {
  min-height: calc(55vh - 160px);
  max-height: calc(70vh - 160px);
  padding: 12px 14px;
  font-size: 14px;
  line-height: 1.7;
  overflow-y: auto;
}

.repair-editor .ql-editor.ql-blank::before {
  left: 14px;
  right: 14px;
  color: var(--el-text-color-placeholder);
  font-style: normal;
}

.repair-editor .ql-editor img {
  max-width: 100%;
  height: auto;
}
</style>
