/**
 * 配置 Store（Pinia）
 *
 * 職責：
 *  - 持有應用配置（AppConfig）的響應式副本
 *  - 提供多個 Getter 派生常用配置子集
 *  - 在應用啟動時通過 IPC 從主進程加載配置
 *
 * 所有 Vue 組件通過此 Store 訪問配置，不直接調用 IPC。
 */

import {defineStore} from 'pinia'
import {computed, ref} from 'vue'
import {logger} from '@/shared/utils/logger'
import {plain} from '@/shared/utils/ipc-clone'
import type {AppConfig, QuickMenuItem, SidebarItem, SystemLink, SystemLinkItem} from '@shared/types/config'

export const useConfigStore = defineStore('config', () => {
  // ─── State ────────────────────────────────────────────────
  /** 完整應用配置（null 表示尚未加載） */
  const appConfig = ref<AppConfig | null>(null)

  /** 配置是否已加載完成 */
  const isLoaded = ref(false)

  /** 配置加載是否發生錯誤 */
  const loadError = ref<string | null>(null)

  // ─── Getters（計算屬性） ─────────────────────────────────
  /** 獲取啟用的側邊欄菜單項（過濾掉 enabled: false 的項） */
  const sidebarItems = computed<SidebarItem[]>(() =>
      (appConfig.value?.sidebar?.items ?? []).filter((item) => item.enabled)
  )

  /** 側邊欄『系統』分組的外部連結（過濾禁用項） */
  const systemLinkItems = computed<SystemLinkItem[]>(() =>
      (appConfig.value?.systemLinks?.items ?? []).filter((item) => item.enabled)
  )

  /** 浮球快捷菜單項（過濾禁用項） */
  const floatingBallMenuItems = computed<QuickMenuItem[]>(() =>
      (appConfig.value?.floatingBall?.quickMenu ?? []).filter((item) => item.enabled)
  )

  /** 浮球配置 */
  const floatingBallConfig = computed(() => appConfig.value?.floatingBall)

  /** 統一平台系統鏈接列表 */
  const platformSystems = computed<SystemLink[]>(
    () => appConfig.value?.unifiedPlatform.systems ?? []
  )

    /** 使用者對各系統打開方式的個人覆寫({ systemId: 'electron-window'|'external-browser' }) */
    const platformOpenModeOverrides = computed(
        () => appConfig.value?.unifiedPlatform.openModeOverrides ?? {}
    )

  /** 內部功能配置 */
  const functionsConfig = computed(() => appConfig.value?.internalFunctions)

  /** 當前語言設置 */
  const language = computed(() => appConfig.value?.app.language ?? 'zh-TW')

  // ─── Actions ──────────────────────────────────────────────
  /**
   * 從主進程加載配置
   * 應在 App.vue 的 onMounted 中最先調用
   */
  async function loadConfig(): Promise<void> {
    try {
      loadError.value = null
      const config = await window.electronAPI.config.read()
      appConfig.value = config
      isLoaded.value = true
    } catch (err) {
      loadError.value = String(err)
      logger.error('配置加載失敗', 'config.store', err)
    }
  }

  /**
   * 寫入部分配置（深合並後保存到磁盤）
   *
   * ⚠️ 呼叫端常見寫法是 `{app: {...appConfig.value!.app, xxx}}` 展開現有配置再改一個欄位 ——
   * 展開只複製第一層,若某欄位本身是物件/陣列(如 unifiedPlatform.systems),展開出來的
   * 還是同一個 Vue reactive Proxy 參照。Electron IPC 的 structured clone 不吃 Proxy,
   * 會拋「An object could not be cloned」。統一在這裡過一次 plain(),呼叫端不用各自記得處理。
   *
   * @param partial 要更新的配置字段
   */
  async function writeConfig(partial: Partial<AppConfig>): Promise<void> {
      await window.electronAPI.config.write(plain(partial))
    // 重新加載以保持 Store 與磁盤同步
    await loadConfig()
  }

    /**
     * 設定某系統的打開方式覆寫(桌面窗口 / 瀏覽器),使用者在系統整理卡片上點選時呼叫。
     * 只 merge 這一個 systemId,不動其他系統已存的覆寫。
     */
    async function setSystemOpenMode(systemId: string, mode: 'electron-window' | 'external-browser'): Promise<void> {
        const current = appConfig.value?.unifiedPlatform
        if (!current) return
        const openModeOverrides = {...current.openModeOverrides, [systemId]: mode}
        await writeConfig({unifiedPlatform: {...current, openModeOverrides}})
    }

  return {
    // State
    appConfig,
    isLoaded,
    loadError,
    // Getters
    sidebarItems,
    systemLinkItems,
    floatingBallMenuItems,
    floatingBallConfig,
    platformSystems,
      platformOpenModeOverrides,
    functionsConfig,
    language,
    // Actions
    loadConfig,
      writeConfig,
      setSystemOpenMode
  }
})
