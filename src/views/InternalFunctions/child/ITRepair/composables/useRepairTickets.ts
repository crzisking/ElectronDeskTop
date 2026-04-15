/**
 * useRepairTickets — 我的工單列表 Composable
 *
 * 封裝「我的工單」Tab 的所有狀態與業務邏輯，包含：
 *  1. 工單列表分頁載入（GET /api/repair/list）
 *  2. 狀態篩選（全部 / 已提交 / 已分配 / 已關閉）
 *  3. 工單詳情彈窗（點擊行 → GET /api/repair/detail/:id → 開啟彈窗）
 *  4. 附件圖片 URL 列表（供 el-image 大圖預覽使用）
 *
 * 模塊級常量 STATUS_LABELS / STATUS_TAG_TYPES 同時 export，
 * 供 ITRepairView.vue 模板中渲染狀態標籤使用，無需通過 composable 傳遞。
 *
 * 使用方：ITRepairView.vue
 */

import { ref, reactive, computed } from 'vue'
import { useAuthStore } from '@/stores/auth.store'
import { repairApi } from '@/api/modules/repair.api'
import type { RepairListItem, RepairDetail, RepairStatus } from '@/types/api.types'

// ── 狀態顯示映射（模塊級常量，直接 export 供模板使用） ────────────

/**
 * 工單狀態碼 → 中文文字映射。
 * 對應後端 status 字段：1 = 已提交、2 = 已分配、3 = 已關閉。
 */
export const STATUS_LABELS: Record<number, string> = {
  1: '已提交',
  2: '已分配',
  3: '已關閉'
}

/**
 * 工單狀態碼 → Element Plus Tag type 映射。
 * 顏色語義：warning（橙，待處理）/ primary（藍，處理中）/ info（灰，已完結）。
 */
export const STATUS_TAG_TYPES: Record<number, 'warning' | 'primary' | 'info'> = {
  1: 'warning',
  2: 'primary',
  3: 'info'
}

export function useRepairTickets() {
  const authStore = useAuthStore()

  // ══════════════════════════════════════════════════════════════════
  // 列表狀態
  // ══════════════════════════════════════════════════════════════════

  /** 列表是否正在請求中，控制 el-table v-loading 顯示 */
  const ticketsLoading = ref(false)

  /** 工單列表資料，綁定到 el-table :data */
  const tickets = ref<RepairListItem[]>([])

  /** 工單總數，用於 el-pagination :total */
  const ticketsTotal = ref(0)

  /**
   * 列表查詢參數（reactive 對象，字段變化時不需要手動解構）。
   *  - pageIndex: 當前頁碼（從 1 開始）
   *  - pageSize:  每頁條數（固定 10，與後端默認值一致）
   *  - status:    狀態篩選（undefined = 全部，1/2/3 = 對應狀態）
   */
  const ticketParams = reactive<{
    pageIndex: number
    pageSize: number
    status: RepairStatus | undefined
  }>({
    pageIndex: 1,
    pageSize: 10,
    status: undefined
  })

  // ══════════════════════════════════════════════════════════════════
  // 列表操作
  // ══════════════════════════════════════════════════════════════════

  /**
   * 載入工單列表，根據 ticketParams 當前值發起請求。
   * 使用當前登入用戶的 userName 作為過濾條件，只查詢自己的工單。
   * 請求成功後更新 tickets 和 ticketsTotal。
   */
  async function loadTickets() {
    ticketsLoading.value = true
    try {
      const res = await repairApi.list({
        userId: authStore.user!.userName,
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

  /**
   * 狀態篩選切換處理：重置到第一頁後重新載入。
   * 避免當前頁碼超出篩選後的總頁數範圍。
   */
  function handleStatusFilter() {
    ticketParams.pageIndex = 1
    loadTickets()
  }

  /**
   * 分頁切換處理：更新頁碼後重新載入列表。
   *
   * @param page 目標頁碼（el-pagination @current-change 事件傳入）
   */
  function handlePageChange(page: number) {
    ticketParams.pageIndex = page
    loadTickets()
  }

  // ══════════════════════════════════════════════════════════════════
  // 詳情彈窗
  // ══════════════════════════════════════════════════════════════════

  /** 詳情彈窗是否可見（v-model 雙向綁定到 RepairDetailDialog） */
  const detailVisible = ref(false)

  /** 詳情彈窗內容是否正在請求中，控制彈窗內 v-loading 顯示 */
  const detailLoading = ref(false)

  /** 當前查看的工單詳情資料，null 表示尚未載入或載入失敗 */
  const currentDetail = ref<RepairDetail | null>(null)

  /**
   * 工單行點擊處理：開啟詳情彈窗並載入完整工單資料。
   * 先開啟彈窗（避免用戶感知延遲），再異步載入詳情。
   * 載入失敗時關閉彈窗，錯誤由 API 層（auth.interceptor）統一顯示。
   *
   * @param row 被點擊的工單列表行資料
   */
  async function handleRowClick(row: RepairListItem) {
    detailVisible.value = true
    detailLoading.value = true
    currentDetail.value = null  // 清空上一次的詳情，防止瞬間顯示舊資料
    try {
      currentDetail.value = await repairApi.detail(row.id)
    } catch {
      // API 錯誤由攔截器統一彈出提示，這裡只需關閉彈窗
      detailVisible.value = false
    } finally {
      detailLoading.value = false
    }
  }

  /**
   * 附件圖片 URL 列表（計算屬性）。
   * 傳給 RepairDetailDialog 的 :preview-src-list，
   * el-image 使用此列表實現點擊圖片後的大圖輪播預覽。
   */
  const previewUrls = computed<string[]>(
    () => currentDetail.value?.attachments.map((a) => a.fileUrl) ?? []
  )

  // ══════════════════════════════════════════════════════════════════
  // 對外暴露
  // ══════════════════════════════════════════════════════════════════

  return {
    ticketsLoading,      // 列表載入中狀態
    tickets,             // 工單列表資料
    ticketsTotal,        // 工單總數（分頁用）
    ticketParams,        // 查詢參數（reactive，可直接 v-model 綁定）
    loadTickets,         // 手動刷新列表
    handleStatusFilter,  // 狀態篩選切換
    handlePageChange,    // 分頁切換

    detailVisible,       // 詳情彈窗顯示狀態（v-model）
    detailLoading,       // 詳情載入中狀態
    currentDetail,       // 當前工單完整詳情
    handleRowClick,      // 行點擊開啟詳情
    previewUrls,         // 附件圖片 URL 列表（大圖預覽用）
  }
}
