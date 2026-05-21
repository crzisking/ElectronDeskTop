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
import { ElNotification, ElMessage } from 'element-plus'
import {i18n} from '@/locales'
import {logger} from '@/utils/logger'

/**
 * useUpdate 是模塊級單例（在 setup() 之外被呼叫），所以不能用 useI18n()。
 * 直接讀 i18n.global.t，並透過函數式包裝確保語言切換時讀的是當前 locale。
 */
const t = (key: string, named?: Record<string, unknown>) =>
  named ? i18n.global.t(key, named) : i18n.global.t(key)

/** 下載完成後到自動重啟之間的緩衝時間，給用戶看到通知並保存工作 */
const RESTART_DELAY_MS = 5_000

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

/**
 * 已通知過的版本號（按事件類型）。
 * 防止同一 push:update-* 事件對同一版本重複彈通知 —— 來源可能是：
 *  1. 主進程在短時間內被多次觸發 check（如登錄檢查 + 用戶手動再點一次）
 *  2. dev 模式 HMR 導致 electronAPI.on 累加監聽器（preload 的 ipcRenderer.on
 *     不會自動去重，舊模塊實例的 wrapper 仍然存活）
 * 用版本字符串識別「同一次更新」，跨重啟才會自然清空（模塊級變量）。
 */
const notifiedAvailableVersion = ref<string>('')
const notifiedDownloadedVersion = ref<string>('')
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

  // 發現新版 → 通知用戶開始背景下載（同一版本只通知一次）
  api.on('push:update-available', (...args: unknown[]) => {
    clearCheckTimeout()
    const info = args[0] as UpdateInfo
    state.value = 'available'
    availableInfo.value = info

    // 去重：同版本不重複彈窗（防止重複監聽 / 重複 check 導致多通知）
    if (notifiedAvailableVersion.value === info.version) {
      logger.debug(`update-available 重複觸發，忽略：${info.version}`, 'useUpdate')
      return
    }
    notifiedAvailableVersion.value = info.version

    // 原文 title：發現新版本 {version}
    // 原文 message：正在背景下載，下載完成後會通知您重啟。
    ElNotification({
      title: t('update.notifyAvailableTitle', {version: info.version}),
      message: t('update.notifyAvailableMsg'),
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
      // 原文：您已是最新版本
      ElMessage.success(t('update.isLatest'))
      userInitiated = false
    }
  })

  // 下載進度
  api.on('push:update-progress', (...args: unknown[]) => {
    clearCheckTimeout()
    state.value = 'downloading'
    progress.value = args[0] as UpdateProgress
  })

  // 下載完成 → 通知用戶後強制重啟（不給延後選項）
  // 設計取捨：避免用戶長期掛在舊版上錯過修復，下載即重啟；
  // 給 RESTART_DELAY_MS 緩衝讓用戶看清通知並保存任何進行中的工作
  api.on('push:update-downloaded', (...args: unknown[]) => {
    clearCheckTimeout()
    const info = args[0] as UpdateInfo
    state.value = 'downloaded'
    availableInfo.value = info

    // 去重：同版本不重複彈窗也不重複觸發重啟定時器
    if (notifiedDownloadedVersion.value === info.version) {
      logger.debug(`update-downloaded 重複觸發，忽略：${info.version}`, 'useUpdate')
      return
    }
    notifiedDownloadedVersion.value = info.version

    // 原文 title：新版本 {version} 已下載完成
    // 原文 message：應用將在 {seconds} 秒後自動重啟以完成安裝，請保存您的工作。
    ElNotification({
      title: t('update.notifyDownloadedTitle', {version: info.version}),
      message: t('update.notifyDownloadedMsg', {seconds: Math.round(RESTART_DELAY_MS / 1000)}),
      type: 'success',
      duration: RESTART_DELAY_MS,
      position: 'bottom-right',
      showClose: false
    })

    setTimeout(() => install(), RESTART_DELAY_MS)
  })

  // 錯誤：清掉超時 timer，更新狀態，必要時提示用戶
  api.on('push:update-error', (...args: unknown[]) => {
    clearCheckTimeout()
    const err = args[0] as { message: string }
    state.value = 'error'
    lastError.value = err.message
    logger.warn('更新流程錯誤', 'useUpdate', err)

    if (userInitiated) {
      // 原文：檢查更新失敗：{message}
      ElMessage.error(t('update.checkFailed', {message: err.message}))
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
      // 原文：檢查更新超時，請稍後再試或檢查網路
      lastError.value = t('update.timeout')
      if (userInitiated) {
        ElMessage.error(lastError.value)
        userInitiated = false
      }
    }
  }, CHECK_TIMEOUT_MS)

  await window.electronAPI.update.check()
}

/**
 * 登錄成功後的靜默檢查更新。
 * 與 manualCheck 的差異：
 *  - 不設置 userInitiated → 「已是最新版」/「失敗」事件不會彈 ElMessage
 *  - 但若真有新版本，bootstrap 中的 ElNotification（line 83）依然會顯示，
 *    用戶仍會收到提醒，符合「登錄時自動發現新版」的預期
 *  - 同樣帶 30 秒超時保護，避免 dev 模式或網路異常時 UI 卡 checking
 *  - 失敗不拋給呼叫方（登錄流程不應因更新檢查失敗而中斷）
 */
async function loginCheck(): Promise<void> {
  // 已經在檢查 / 下載中就不要重複觸發
  if (state.value === 'checking' || state.value === 'downloading') return

  state.value = 'checking'
  if (checkTimeoutTimer) clearTimeout(checkTimeoutTimer)
  checkTimeoutTimer = setTimeout(() => {
    if (state.value === 'checking') {
      state.value = 'idle' // 靜默回退，不彈錯誤
      logger.warn('登錄後檢查更新超時（靜默忽略）', 'useUpdate')
    }
  }, CHECK_TIMEOUT_MS)

  try {
    await window.electronAPI.update.check()
  } catch (err) {
    clearCheckTimeout()
    state.value = 'idle'
    logger.warn('登錄後檢查更新失敗（靜默忽略）', 'useUpdate', err)
  }
}

/** 清除超時 timer（任何 push:update-* 事件抵達後呼叫） */
function clearCheckTimeout(): void {
  if (checkTimeoutTimer) {
    clearTimeout(checkTimeoutTimer)
    checkTimeoutTimer = null
  }
}

/**
 * 立即重啟並安裝新版。
 * 由 push:update-downloaded handler 在 RESTART_DELAY_MS 緩衝後自動呼叫，
 * 用戶不再有手動觸發的入口（自動更新策略：下載完即裝，不允許延後）。
 */
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
    loginCheck
  }
}
