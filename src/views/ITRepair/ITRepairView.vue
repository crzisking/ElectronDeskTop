<script setup lang="ts">
/**
 * IT 報修工單頁面（用戶端）
 *
 * 功能：
 *  1. 提交報修 — 填寫問題描述 + 上傳圖片 → POST /api/repair/create
 *  2. 我的工單 — 查看自己提交的工單列表（含狀態過濾、分頁、詳情彈窗）
 *
 * 上傳流程（el-upload http-request 自定義）：
 *  用戶選圖 → 立即上傳到後端 → 拿到 OSS URL → 存入 uploadedAttachments
 *  點擊「提交報修」→ 將描述 + URL 列表一起 POST 到後端
 *
 * 注意：所有圖片必須上傳完成後才允許提交（uploadingCount > 0 時禁用按鈕）
 */

import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import type { UploadFile, UploadRequestOptions, FormInstance } from 'element-plus'
import { useAuthStore } from '@/stores/auth.store'
import { repairApi } from '@/api/modules/repair.api'
import type { RepairListItem, RepairDetail, RepairAttachment, RepairStatus } from '@/types/api.types'
import { Plus, ArrowLeft, View } from '@element-plus/icons-vue'

const authStore = useAuthStore()

// ══════════════════════════════════════════════════════════════════
// Tab 狀態
// ══════════════════════════════════════════════════════════════════

const activeTab = ref<'submit' | 'tickets'>('submit')

function onTabChange(name: string | number) {
  if (name === 'tickets' && tickets.value.length === 0 && !ticketsLoading.value) {
    loadTickets()
  }
}

// ══════════════════════════════════════════════════════════════════
// 提交報修 Tab
// ══════════════════════════════════════════════════════════════════

const submitFormRef = ref<FormInstance>()
const submitForm = reactive({ description: '' })
const submitRules = {
  description: [
    { required: true, message: '請填寫問題描述', trigger: 'blur' },
    { max: 2000, message: '描述不超過 2000 個字元', trigger: 'blur' }
  ]
}

/** 已上傳成功的附件（每個條目有 fileUrl + fileName） */
const uploadedAttachments = ref<RepairAttachment[]>([])

/** 上傳中的文件數量（> 0 時禁用提交按鈕） */
const uploadingCount = ref(0)

/** el-upload 的文件列表（受控，用於手動清空） */
const uploadFileList = ref<UploadFile[]>([])

/** 是否正在提交工單 */
const submitting = ref(false)

/** 是否有圖片正在上傳中 */
const uploading = computed(() => uploadingCount.value > 0)

/**
 * 圖片上傳前校驗（類型 + 大小）
 */
function beforeUpload(rawFile: File): boolean {
  if (!rawFile.type.startsWith('image/')) {
    ElMessage.error('只能上傳圖片文件（jpg / png / gif 等）')
    return false
  }
  if (rawFile.size > 10 * 1024 * 1024) {
    ElMessage.error(`${rawFile.name} 超過 10MB，請壓縮後重試`)
    return false
  }
  return true
}

/**
 * el-upload 自定義上傳函數
 * 用戶選圖後立即上傳，成功後將 URL 存入 uploadedAttachments
 */
async function handleUpload(options: UploadRequestOptions) {
  uploadingCount.value++
  try {
    const result = await repairApi.uploadFile(options.file as File)
    uploadedAttachments.value.push({ fileUrl: result.fileUrl, fileName: result.fileName })
    options.onSuccess(result)
  } catch (e) {
    options.onError(e as ProgressEvent)
    ElMessage.error(`${(options.file as File).name} 上傳失敗，請重試`)
  } finally {
    uploadingCount.value--
  }
}

/**
 * 移除已上傳圖片時，同步從 uploadedAttachments 中刪除對應 URL
 * 用 file.response（上傳成功的響應對象）精確匹配
 */
function handleUploadRemove(file: UploadFile) {
  if (file.response) {
    const resp = file.response as { fileUrl: string }
    const idx = uploadedAttachments.value.findIndex((a) => a.fileUrl === resp.fileUrl)
    if (idx !== -1) uploadedAttachments.value.splice(idx, 1)
  }
}

/**
 * 提交報修工單
 * 1. 表單校驗
 * 2. 等待所有圖片上傳完成
 * 3. POST 到後端
 * 4. 重置表單，切換到「我的工單」Tab
 */
async function handleSubmit() {
  try {
    await submitFormRef.value!.validate()
  } catch {
    return
  }

  if (uploading.value) {
    ElMessage.warning('請等待圖片上傳完成後再提交')
    return
  }

  submitting.value = true
  try {
    const result = await repairApi.create({
      userId: authStore.user!.id,
      userName: authStore.user!.name,
      description: submitForm.description,
      attachments: uploadedAttachments.value
    })
    ElMessage.success(`報修提交成功！工單號：${result.requestNo}`)
    // 重置表單
    submitForm.description = ''
    uploadedAttachments.value = []
    uploadFileList.value = []
    submitFormRef.value?.resetFields()
    // 切換到「我的工單」並刷新列表
    activeTab.value = 'tickets'
    ticketParams.pageIndex = 1
    await loadTickets()
  } finally {
    submitting.value = false
  }
}

// ══════════════════════════════════════════════════════════════════
// 我的工單 Tab
// ══════════════════════════════════════════════════════════════════

const ticketsLoading = ref(false)
const tickets = ref<RepairListItem[]>([])
const ticketsTotal = ref(0)

const ticketParams = reactive<{
  pageIndex: number
  pageSize: number
  status: RepairStatus | undefined
}>({
  pageIndex: 1,
  pageSize: 10,
  status: undefined
})

async function loadTickets() {
  ticketsLoading.value = true
  try {
    const res = await repairApi.list({
      userId: authStore.user!.id,
      pageIndex: ticketParams.pageIndex,
      pageSize: ticketParams.pageSize,
      status: ticketParams.status
    })
    tickets.value = res.list
    ticketsTotal.value = res.total
  } finally {
    ticketsLoading.value = false
  }
}

function handleStatusFilter() {
  ticketParams.pageIndex = 1
  loadTickets()
}

function handlePageChange(page: number) {
  ticketParams.pageIndex = page
  loadTickets()
}

// ── 工單詳情彈窗 ────────────────────────────────────────────────────
const detailVisible = ref(false)
const detailLoading = ref(false)
const currentDetail = ref<RepairDetail | null>(null)

async function handleRowClick(row: RepairListItem) {
  detailVisible.value = true
  detailLoading.value = true
  currentDetail.value = null
  try {
    currentDetail.value = await repairApi.detail(row.id)
  } catch {
    detailVisible.value = false
  } finally {
    detailLoading.value = false
  }
}

// ── 狀態映射 ────────────────────────────────────────────────────────
const STATUS_LABELS: Record<number, string> = {
  1: '已提交',
  2: '已分配',
  3: '已關閉'
}
const STATUS_TAG_TYPES: Record<number, 'warning' | 'primary' | 'info'> = {
  1: 'warning',
  2: 'primary',
  3: 'info'
}

// ── 圖片大圖預覽 ────────────────────────────────────────────────────
const previewUrls = computed<string[]>(
  () => currentDetail.value?.attachments.map((a) => a.fileUrl) ?? []
)
</script>

<template>
  <div class="it-repair-view">
    <!-- 頁面頭部 -->
    <div class="page-header">
      <div>
        <h2 class="page-title">IT 報修</h2>
        <p class="page-subtitle">提交設備故障或 IT 相關問題，IT 人員將儘快處理</p>
      </div>
    </div>

    <!-- 主體 Tab -->
    <el-tabs
      v-model="activeTab"
      class="repair-tabs"
      @tab-change="onTabChange"
    >
      <!-- ── 提交報修 Tab ──────────────────────────────────────── -->
      <el-tab-pane label="提交報修" name="submit">
        <el-form
          ref="submitFormRef"
          :model="submitForm"
          :rules="submitRules"
          label-position="top"
          class="submit-form"
        >
          <!-- 問題描述 -->
          <el-form-item label="問題描述" prop="description">
            <el-input
              v-model="submitForm.description"
              type="textarea"
              :rows="6"
              :maxlength="2000"
              show-word-limit
              placeholder="請詳細描述您遇到的問題，例如：電腦無法開機、滑鼠不回應、網路斷線等"
              resize="none"
            />
          </el-form-item>

          <!-- 上傳圖片 -->
          <el-form-item label="附件圖片（選填，最多 5 張，每張不超過 10MB）">
            <el-upload
              v-model:file-list="uploadFileList"
              list-type="picture-card"
              :http-request="handleUpload"
              :before-upload="beforeUpload"
              :on-remove="handleUploadRemove"
              accept="image/*"
              :limit="5"
              :on-exceed="() => ElMessage.warning('最多只能上傳 5 張圖片')"
            >
              <el-icon><Plus /></el-icon>
              <template #tip>
                <div class="upload-tip">
                  支持 JPG、PNG、GIF 等圖片格式，建議上傳故障截圖或現場照片
                </div>
              </template>
            </el-upload>
          </el-form-item>

          <!-- 上傳進度提示 -->
          <div v-if="uploading" class="upload-progress-hint">
            <el-icon class="is-loading"><Loading /></el-icon>
            正在上傳圖片，請稍候...
          </div>

          <!-- 提交按鈕 -->
          <el-form-item>
            <el-button
              type="primary"
              size="large"
              :loading="submitting"
              :disabled="uploading"
              style="min-width: 140px"
              @click="handleSubmit"
            >
              {{ submitting ? '提交中...' : '提交報修' }}
            </el-button>
            <span v-if="uploading" class="submit-disabled-hint">
              請等待圖片上傳完成
            </span>
          </el-form-item>
        </el-form>
      </el-tab-pane>

      <!-- ── 我的工單 Tab ──────────────────────────────────────── -->
      <el-tab-pane label="我的工單" name="tickets">
        <!-- 狀態過濾 + 刷新 -->
        <div class="tickets-toolbar">
          <el-radio-group v-model="ticketParams.status" @change="handleStatusFilter">
            <el-radio-button :value="undefined">全部</el-radio-button>
            <el-radio-button :value="1">已提交</el-radio-button>
            <el-radio-button :value="2">已分配</el-radio-button>
            <el-radio-button :value="3">已關閉</el-radio-button>
          </el-radio-group>
          <el-button :loading="ticketsLoading" @click="loadTickets">刷新</el-button>
        </div>

        <!-- 工單列表 -->
        <el-table
          :data="tickets"
          v-loading="ticketsLoading"
          row-class-name="clickable-row"
          @row-click="handleRowClick"
          empty-text="暫無工單記錄"
          style="width: 100%"
        >
          <el-table-column prop="requestNo" label="工單號" width="200" />
          <el-table-column prop="description" label="問題描述" min-width="200" show-overflow-tooltip />
          <el-table-column label="狀態" width="100">
            <template #default="{ row }">
              <el-tag :type="STATUS_TAG_TYPES[row.status]" size="small">
                {{ STATUS_LABELS[row.status] }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="assignedName" label="處理人" width="120">
            <template #default="{ row }">
              <span>{{ row.assignedName ?? '待分配' }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="createTime" label="提交時間" width="170" />
          <el-table-column label="操作" width="80" align="center">
            <template #default>
              <el-button link type="primary" size="small">
                <el-icon><View /></el-icon>
                詳情
              </el-button>
            </template>
          </el-table-column>
        </el-table>

        <!-- 分頁 -->
        <el-pagination
          v-if="ticketsTotal > ticketParams.pageSize"
          v-model:current-page="ticketParams.pageIndex"
          :page-size="ticketParams.pageSize"
          :total="ticketsTotal"
          layout="total, prev, pager, next"
          class="tickets-pagination"
          @current-change="handlePageChange"
        />

        <!-- 空狀態 -->
        <el-empty
          v-if="!ticketsLoading && tickets.length === 0"
          description="您還沒有提交過工單"
          :image-size="100"
        />
      </el-tab-pane>
    </el-tabs>

    <!-- ── 工單詳情彈窗 ────────────────────────────────────────── -->
    <el-dialog
      v-model="detailVisible"
      title="工單詳情"
      width="640px"
      :close-on-click-modal="false"
      destroy-on-close
    >
      <div v-loading="detailLoading" class="detail-content">
        <template v-if="currentDetail">
          <!-- 基本信息 -->
          <el-descriptions :column="2" border size="small">
            <el-descriptions-item label="工單號" :span="2">
              <span class="request-no">{{ currentDetail.requestNo }}</span>
            </el-descriptions-item>
            <el-descriptions-item label="狀態">
              <el-tag :type="STATUS_TAG_TYPES[currentDetail.status]">
                {{ STATUS_LABELS[currentDetail.status] }}
              </el-tag>
            </el-descriptions-item>
            <el-descriptions-item label="提交人">
              {{ currentDetail.userName }}
            </el-descriptions-item>
            <el-descriptions-item label="提交時間">
              {{ currentDetail.createTime }}
            </el-descriptions-item>
            <el-descriptions-item label="處理人">
              {{ currentDetail.assignedName ?? '待分配' }}
            </el-descriptions-item>
            <template v-if="currentDetail.assignTime">
              <el-descriptions-item label="分配時間">
                {{ currentDetail.assignTime }}
              </el-descriptions-item>
              <el-descriptions-item label="分配操作人">
                {{ currentDetail.assignerName ?? '-' }}
              </el-descriptions-item>
            </template>
            <el-descriptions-item label="問題描述" :span="2">
              <div class="description-text">{{ currentDetail.description }}</div>
            </el-descriptions-item>
          </el-descriptions>

          <!-- 附件圖片 -->
          <template v-if="currentDetail.attachments.length > 0">
            <div class="attachments-title">附件圖片（{{ currentDetail.attachments.length }} 張）</div>
            <div class="attachments-grid">
              <el-image
                v-for="(att, idx) in currentDetail.attachments"
                :key="idx"
                :src="att.fileUrl"
                :preview-src-list="previewUrls"
                :initial-index="idx"
                fit="cover"
                class="attachment-thumb"
              >
                <template #error>
                  <div class="attachment-error">載入失敗</div>
                </template>
              </el-image>
            </div>
          </template>
        </template>
      </div>

      <template #footer>
        <el-button @click="detailVisible = false">關閉</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script lang="ts">
import { Loading } from '@element-plus/icons-vue'
export default { components: { Loading } }
</script>

<style scoped>
.it-repair-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 24px;
  box-sizing: border-box;
  gap: 16px;
}

/* 頁面頭部 */
.page-header {
  flex-shrink: 0;
}

.page-title {
  font-size: 22px;
  font-weight: 700;
  color: var(--el-text-color-primary);
  margin: 0 0 4px 0;
}

.page-subtitle {
  font-size: 13px;
  color: var(--el-text-color-secondary);
  margin: 0;
}

/* Tab 容器 */
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

/* 提交表單 */
.submit-form {
  max-width: 720px;
}

.upload-tip {
  font-size: 12px;
  color: var(--el-text-color-placeholder);
  margin-top: 8px;
  line-height: 1.5;
}

.upload-progress-hint {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--el-color-primary);
  margin-bottom: 12px;
}

.submit-disabled-hint {
  margin-left: 12px;
  font-size: 12px;
  color: var(--el-text-color-placeholder);
}

/* 工單列表 */
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

/* 讓整行可點擊 */
.it-repair-view :deep(.clickable-row) {
  cursor: pointer;
}

.it-repair-view :deep(.clickable-row:hover > td) {
  background-color: var(--el-fill-color-light) !important;
}

/* 詳情彈窗 */
.detail-content {
  min-height: 100px;
}

.request-no {
  font-family: monospace;
  font-weight: 600;
  color: var(--el-color-primary);
}

.description-text {
  white-space: pre-wrap;
  line-height: 1.6;
  word-break: break-all;
}

.attachments-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  margin: 16px 0 10px;
}

.attachments-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.attachment-thumb {
  width: 100px;
  height: 100px;
  border-radius: 6px;
  border: 1px solid var(--el-border-color-lighter);
  cursor: zoom-in;
}

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
