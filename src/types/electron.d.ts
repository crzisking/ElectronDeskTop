/**
 * window.electronAPI 類型聲明
 *
 * 擴展全局 Window 接口，為渲染進程提供完整的 TypeScript 類型支持。
 * 實際實現在 electron/preload/index.ts 中通過 contextBridge 注入。
 *
 * 渲染進程的所有 Electron 功能調用必須通過 window.electronAPI，
 * 嚴禁直接使用 require('electron') 或 window.require。
 */

import type {AppConfig} from './config.types'

// 確保此文件被視為模塊（避免全局聲明衝突）
export {}

declare global {
  interface Window {
    electronAPI: {
      // ─── 配置管理 ────────────────────────────────────────────
      config: {
        /**
         * 讀取完整應用配置
         * @returns 解析後的 AppConfig 對象
         */
        read: () => Promise<AppConfig>
        /**
         * 寫入部分配置（深合並）
         * @param config 要更新的配置字段（Partial）
         */
        write: (config: Partial<AppConfig>) => Promise<void>
      }

      // ─── 主窗口控制 ──────────────────────────────────────────
      window: {
        /** 最小化主窗口到任務欄 */
        minimize: () => void
        /** 切換最大化 / 還原 */
        maximize: () => void
        /**
         * 關閉主窗口（隱藏 + 顯示浮球，不退出應用）
         * 若需退出應用，使用 floatingBall 菜單的 quit-app action
         */
        close: () => void
        /** 顯示主窗口並帶到前台 */
        show: () => void
        /** 隱藏主窗口 + 顯示浮球 */
        hide: () => void
        /** 查詢主窗口當前是否最大化 */
        isMaximized: () => Promise<boolean>
        /**
         * 在新的 Electron 子窗口中打開指定 URL
         * 用於 openMode 為 'electron-window' 的系統（不受 iframe X-Frame-Options 限制）
         * @param url   系統的訪問 URL
         * @param title 子窗口標題（顯示在任務欄）
         */
        openChild: (url: string, title: string) => Promise<void>
      }

      // ─── 浮球控制 ────────────────────────────────────────────
      floatingBall: {
        /** 顯示浮球窗口 */
        show: () => void
        /** 隱藏浮球窗口 */
        hide: () => void
        /**
         * 開始拖動浮球
         * 調用後主進程開始以 ~60fps 輪詢游標位置更新浮球位置
         * 必須在 mousedown 事件中調用
         */
        startDrag: () => void
        /**
         * 停止拖動浮球
         * 停止輪詢並觸發邊緣吸附動畫
         * 必須在 mouseup 事件中調用
         */
        stopDrag: () => void
        /**
         * 監聽快捷菜單操作事件（從主窗口路由到對應頁面）
         * @param callback 接收菜單項 routeName 的回調
         */
        onMenuAction: (callback: (routeName: string) => void) => void
      }

      // ─── 日誌（渲染進程 → 主進程文件） ────────────────────────
      /**
       * 渲染端日誌 API。
       * 通常透過 src/utils/logger.ts 封裝後使用，不直接呼叫此處。
       */
      log: {
        /** 寫一條日誌到 <userData>/logs/renderer-YYYY-MM-DD.log */
        write: (entry: {
          level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'
          message: string
          module?: string
          args?: unknown[]
        }) => void
        /** 在 OS 檔案總管中打開日誌資料夾，返回路徑 */
        openFolder: () => Promise<{ ok: boolean; dir: string }>
      }

      // ─── 自動更新（electron-updater） ─────────────────────────
      /**
       * 自動更新主動 API。
       * 更新「狀態事件」通過 electronAPI.on(channel, cb) 訂閱，頻道：
       *   push:update-checking / push:update-available / push:update-not-available
       *   push:update-progress / push:update-downloaded / push:update-error
       *
       * 渲染層通常透過 useUpdate composable（src/composables/useUpdate.ts）
       * 統一封裝這些事件監聽 + 對應 UI 提示，不直接呼叫此處的方法。
       */
      update: {
        /** 手動觸發檢查更新（例如「關於」頁面的按鈕） */
        check: () => Promise<unknown>
        /** 手動觸發下載（autoDownload=false 時使用） */
        download: () => Promise<unknown>
        /** 用戶確認後立即重啟並安裝新版（NSIS oneClick 模式靜默完成） */
        quitAndInstall: () => Promise<void>
      }

      // ─── 浮球原生右鍵菜單 ─────────────────────────────────
      /**
       * 請求主進程在光標位置彈出原生 context menu
       * 僅浮球窗口的 preload 提供此方法
       */
      showContextMenu: () => void

      // ─── 浮球菜單操作（舊 Vue overlay 方式，已保留供兼容） ──────
      executeMenuAction: (actionType: string, payload?: string) => void

      // ─── 通用 IPC 事件監聽 ─────────────────────────────────
      /**
       * 監聽主進程推送事件
       * @param channel 事件頻道名（使用 IpcChannels 常量）
       * @param callback 事件回調
       */
      on: (channel: string, callback: (...args: unknown[]) => void) => void
      /**
       * 取消監聽主進程推送事件
       * @param channel 事件頻道名
       * @param callback 要移除的回調（必須是同一個函數引用）
       */
      off: (channel: string, callback: (...args: unknown[]) => void) => void
    }
  }
}
