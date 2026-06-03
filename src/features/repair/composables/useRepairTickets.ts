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

import {reactive, ref} from 'vue'
import {useAuthStore} from '@/stores/auth.store'
import {repairApi} from '../api'
import {logger} from '@/shared/utils/logger'
import type {RepairDetail, RepairListItem, RepairStatus} from '../types'

// ── 狀態顯示映射（模塊級常量，直接 export 供模板使用） ────────────

/**
 * 工單狀態碼 → i18n key 映射。
 * 模板用法：{{ t(STATUS_LABELS[row.status]) }}
 * 對應後端 status 字段：1 = 已提交、2 = 已分配、3 = 已關閉。
 * 原文：'已提交' / '已分配' / '已關閉'
 */
export const STATUS_LABELS: Record<number, string> = {
  1: 'repair.statusSubmitted',
  2: 'repair.statusAssigned',
  3: 'repair.statusClosed'
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
   *  - status:    狀態篩選（0 = 全部，1/2/3 = 對應狀態）
   *
   * 註：status 使用 0 作為「全部」哨兵值而非 undefined。
   * 原因：el-radio-button 的 :value 若為 undefined 會觸發 Element Plus
   *      "label act as value is about to be deprecated" 告警（內部會回退
   *      到已廢棄的 label-as-value 路徑）。在 loadTickets 發起請求時
   *      將 0 映射回 undefined，對後端仍是「不傳 status」的語義。
   */
  const ticketParams = reactive<{
    pageIndex: number
    pageSize: number
    status: RepairStatus | 0
  }>({
    pageIndex: 1,
    pageSize: 10,
    status: 0
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
    const userName = authStore.user?.userName
    if (!userName) {
      logger.warn('用戶未登入，無法載入工單', 'useRepairTickets')
      return
    }

    ticketsLoading.value = true
    try {
      const res = await repairApi.list({
        userId: userName,
        pageIndex: ticketParams.pageIndex,
        pageSize: ticketParams.pageSize,
        // 0（全部）映射為 undefined，相當於不傳 status 給後端
        status: ticketParams.status === 0 ? undefined : ticketParams.status
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
  }
}
