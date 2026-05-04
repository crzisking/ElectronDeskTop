/**
 * useUpdate — 自動更新渲染層 Composable
 *
 * 職責：
 *  1. 訂閱主進程推送的更新生命週期事件（push:update-*）
 *  2. 把事件轉換成可讀的響應式狀態（state / progress / available info）
 *  3. 在關鍵節點彈出對應的 ElNotification / ElMessageBox 提示用戶
 *  4. 提供 manualCheck() / install() 兩個對外方法
 *
 * 使用方式：在 App.vue 的 onMounted 中呼叫 useUpdate.bootstrap()，
 * 應用整個生命週期內只需要呼叫一次。
 *
 * 配合：
 *  - electron/main/update-manager.ts 推送事件
 *  - electron/preload/index.ts 暴露的 window.electronAPI.update / on / off
 */

import { ref, readonly } from 'vue'
import { ElNotification, ElMessageBox, ElMessage } from 'element-plus'
import {logger} from '@/utils/logger'

/** 更新流程當前狀態 */
type UpdateState =
  | 'idle'         // 沒在做任何事
  | 'checking'     // 檢查中
  | 'available'    // 已知有新版（autoDownload=true 會立刻進入 downloading）
  | 'downloading'  // 下載中（伴隨 progress 事件）
  | 'downloaded'   // 下載完成等待重啟
  | 'not-available'
  | 'error'

interface UpdateProgress {
  percent: number
  bytesPerSecond: number
  transferred: number
  total: number
}

interface UpdateInfo {
  version: string
  releaseNotes?: string
  releaseDate?: string
}

// ── 模塊級單例狀態（整個應用共享） ──────────────────────────────
const state = ref<UpdateState>('idle')
const lastError = ref<string>('')
const progress = ref<UpdateProgress>({
  percent: 0,
  bytesPerSecond: 0,
  transferred: 0,
  total: 0
})
const availableInfo = ref<UpdateInfo | null>(null)

let initialized = false

/** 是否由用戶主動點擊「檢查更新」觸發 — 影響「已是最新版」是否要顯示提示 */
let userInitiated = false

/**
 * 啟動更新監聽（只能呼叫一次，重複呼叫會被忽略）。
 * 建議在 App.vue 的 onMounted 中執行，App.vue 卸載時自動跟隨應用結束。
 */
function bootstrap(): void {
  if (initialized) return
  initialized = true

  const api = window.electronAPI

  // 開始檢查
  api.on('push:update-checking', () => {
    state.value = 'checking'
  })

  // 發現新版
  api.on('push:update-available', (...args: unknown[]) => {
    clearCheckTimeout()
    const info = args[0] as UpdateInfo
    state.value = 'available'
    availableInfo.value = info

    ElNotification({
      title: `發現新版本 ${info.version}`,
      message: '正在背景下載，下載完成後會通知您重啟。',
      type: 'info',
      duration: 6000,
      position: 'bottom-right'
    })
  })

  // 已是最新版
  api.on('push:update-not-available', () => {
    clearCheckTimeout()
    state.value = 'not-available'
    if (userInitiated) {
      ElMessage.success('您已是最新版本')
      userInitiated = false
    }
  })

  // 下載進度
  api.on('push:update-progress', (...args: unknown[]) => {
    clearCheckTimeout()
    state.value = 'downloading'
    progress.value = args[0] as UpdateProgress
  })

  // 下載完成 → 詢問用戶是否立即重啟
  api.on('push:update-downloaded', async (...args: unknown[]) => {
    clearCheckTimeout()
    const info = args[0] as UpdateInfo
    state.value = 'downloaded'
    availableInfo.value = info

    const confirmed = await ElMessageBox.confirm(
      `新版本 ${info.version} 已下載完成，立即重啟以完成安裝？`,
      '更新就緒',
      {
        confirmButtonText: '立即重啟',
        cancelButtonText: '稍後再說',
        type: 'success',
        center: true,
        closeOnClickModal: false
      }
    ).catch(() => false)

    if (confirmed) {
      install()
    }
    // 用戶選「稍後」→ 等下次退出時自動安裝（若 autoInstallOnAppQuit=true）
    // 或下次手動關閉應用時觸發
  })

  // 錯誤：清掉超時 timer，更新狀態，必要時提示用戶
  api.on('push:update-error', (...args: unknown[]) => {
    clearCheckTimeout()
    const err = args[0] as { message: string }
    state.value = 'error'
    lastError.value = err.message
    logger.warn('更新流程錯誤', 'useUpdate', err)

    if (userInitiated) {
      ElMessage.error(`檢查更新失敗：${err.message}`)
      userInitiated = false
    }
  })
}

/** 「檢查中」最長等待秒數，超時自動顯示錯誤避免 UI 永遠 loading */
const CHECK_TIMEOUT_MS = 30_000

let checkTimeoutTimer: ReturnType<typeof setTimeout> | null = null

/**
 * 手動觸發檢查更新（例如「關於」頁面按鈕）。
 * 設置 userInitiated 標記，讓「已是最新版/失敗」的事件能彈出提示。
 *
 * 加超時保護：若 30 秒內主進程沒有發任何 push:update-* 事件，
 * 強制把 state 切回 'error'，避免 UI 永遠卡在 checking。
 * （主因：autoUpdater 在某些異常情況下不發 error，例如網路完全 unreachable。）
 */
async function manualCheck(): Promise<void> {
  userInitiated = true
  state.value = 'checking'

  // 啟動超時 timer
  if (checkTimeoutTimer) clearTimeout(checkTimeoutTimer)
  checkTimeoutTimer = setTimeout(() => {
    if (state.value === 'checking') {
      state.value = 'error'
      lastError.value = '檢查更新超時，請稍後再試或檢查網路'
      if (userInitiated) {
        ElMessage.error(lastError.value)
        userInitiated = false
      }
    }
  }, CHECK_TIMEOUT_MS)

  await window.electronAPI.update.check()
}

/** 清除超時 timer（任何 push:update-* 事件抵達後呼叫） */
function clearCheckTimeout(): void {
  if (checkTimeoutTimer) {
    clearTimeout(checkTimeoutTimer)
    checkTimeoutTimer = null
  }
}

/** 立即重啟並安裝新版（用戶點擊「立即重啟」按鈕後呼叫） */
function install(): void {
  void window.electronAPI.update.quitAndInstall()
}

export function useUpdate() {
  return {
    state: readonly(state),
    lastError: readonly(lastError),
    progress: readonly(progress),
    availableInfo: readonly(availableInfo),
    bootstrap,
    manualCheck,
    install
  }
}
