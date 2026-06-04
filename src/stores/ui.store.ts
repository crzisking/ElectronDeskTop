/**
 * UI 視覺狀態（側邊欄折疊、最大化、全局加載遮罩）。
 * 用於：SidebarNav、TitleBar、App.vue 等。
 * 與 auth.store 分離：這裡只管界面外觀，不涉及身份。
 */

import {defineStore} from 'pinia'
import {ref} from 'vue'

/** SettingsDialog 內的 section key,呼叫 openSettings 時可指定要焦點哪個分區 */
export type SettingsSection = 'update' | 'language' | 'log' | 'llm'

export const useUiStore = defineStore('ui', () => {

  // ─── State ────────────────────────────────────────────────

  /** 側邊欄是否折疊（true = 圖標模式）；SidebarNav 綁 CSS class 使用 */
  const sidebarCollapsed = ref<boolean>(false)

  /**
   * 主窗口是否最大化（從主進程 IPC 推送同步過來）。
   * 渲染進程無法直接讀 BrowserWindow 狀態，須由 App.vue 監聽 push:window-maximized 後寫入。
   * TitleBar 依此切換最大化/還原按鈕圖標。
   */
  const isWindowMaximized = ref<boolean>(false)

  /** 全局加載遮罩：應用啟動初始化期間顯示，初始化完成後設為 false */
  const globalLoading = ref<boolean>(true)

  /**
   * 設置 dialog 顯示狀態 + 預設展開的 section。
   *
   * 為何放 ui.store 而非各 component 自管:
   *   SettingsDialog 原本 ref 在 SidebarUserCorner 內,跨組件呼叫(例:工作分析的
   *   「沒配 provider 請打開設定」toast)沒法觸發。集中到 ui.store,任何頁面都能
   *   `useUiStore().openSettings('llm')` 直接打開到對應 section。
   *
   * 沒有「目前焦點 section」概念時設 null —— SettingsDialog 不會做特殊滾動定位。
   */
  const settingsVisible = ref<boolean>(false)
  const settingsFocusSection = ref<SettingsSection | null>(null)

  // ─── Actions ──────────────────────────────────────────────

  /** 切換側邊欄折疊狀態（漢堡按鈕點擊用） */
  function toggleSidebar(): void {
    sidebarCollapsed.value = !sidebarCollapsed.value
  }

  /**
   * 直接設定側邊欄折疊狀態。
   * 用於：App.vue 從 config 套用 defaultCollapsed、響應式佈局自動折疊。
   * @param collapsed true = 折疊，false = 展開
   */
  function setSidebarCollapsed(collapsed: boolean): void {
    sidebarCollapsed.value = collapsed
  }

  /**
   * 同步主窗口最大化狀態。
   * 用於：App.vue 監聽 push:window-maximized 事件後呼叫。
   * @param maximized true = 已最大化
   */
  function setWindowMaximized(maximized: boolean): void {
    isWindowMaximized.value = maximized
  }

  /** 隱藏全局加載遮罩；App.vue onMounted 所有初始化完成後呼叫 */
  function hideGlobalLoading(): void {
    globalLoading.value = false
  }

  /**
   * 打開設置 dialog,可選擇要焦點的 section。
   * @param section 未指定 = 預設展開全部(不滾動定位)
   */
  function openSettings(section?: SettingsSection): void {
    settingsFocusSection.value = section ?? null
    settingsVisible.value = true
  }

  /** 關閉設置 dialog,順手清掉焦點 section 狀態 */
  function closeSettings(): void {
    settingsVisible.value = false
    settingsFocusSection.value = null
  }

  return {
    // State
    sidebarCollapsed,
    isWindowMaximized,
    globalLoading,
    settingsVisible,
    settingsFocusSection,
    // Actions
    toggleSidebar,
    setSidebarCollapsed,
    setWindowMaximized,
    hideGlobalLoading,
    openSettings,
    closeSettings,
  }
})
