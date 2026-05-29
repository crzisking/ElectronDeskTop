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
import type {WorkRecord, WorkResultPayload} from '@/features/work-collect/types'
import type {UserProfile, UserProfileUpsertInput} from '@/features/user-profile/types'

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
       * 渲染層通常透過 useUpdate composable（src/features/update/use-update.ts）
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

      // ─── 日誌查看器(密碼保護) ───────────────────────────────
      logViewer: {
        /**
         * 驗證密碼。成功則主進程本 session 內記住已解鎖,
         * 後續 openWindow() 與子視窗內的 query 才會放行。
         * @returns true=密碼正確,false=密碼錯誤
         */
        unlock: (password: string) => Promise<boolean>
        /**
         * 開啟日誌查看器子視窗。必須先 unlock 成功;否則主進程會靜默拒絕。
         */
        openWindow: () => void
      }

      // ─── 工作自動採集 ──────────────────────────────────────
      workCollect: {
        /**
         * 切換採集開關。主進程會寫進 config 並啟停 scheduler。
         * @returns 切換後的 enabled 狀態
         */
        toggle: (enabled: boolean) => Promise<boolean>

        /**
         * 查詢採集紀錄,給流水線 UI 顯示用。
         * @param params since/until 用 Unix ms,半開區間 [since, until)
         * @returns 按時間升序的紀錄陣列
         */
        list: (params: {since: number; until: number}) => Promise<WorkRecord[]>

        /**
         * 把 AI 分析結果回送主進程,由 main handler 寫進 DB 並推 PUSH_WORK_RECORD_NEW。
         * payload 形狀:WorkResultPayload(見 src/features/work-collect/types.ts)
         */
        sendResult: (payload: WorkResultPayload) => void

        // ─── 集中化(docs/20)新增 ──────────────────────────────────

        /**
         * 列出本地 synced=0 的紀錄,sync-daily 撈 unsynced 用。
         * limit 預設 200,跟 server 單請求上限對齊。
         */
        listUnsynced: (limit?: number) => Promise<WorkRecord[]>

        /**
         * 把指定 localIds 標記為已同步;syncedAt 用 server 返回的 ms。
         * 失敗會 log,不丟例外(下次 sync 會再撈到)。
         */
        markSynced: (localIds: number[], syncedAt: number) => Promise<void>

        /**
         * server 拉回來的配置寫入本地 + 視變更重啟 scheduler。
         * @returns changed=true 表示配置實際有變(已套用 + restart),false=本地已是最新
         */
        applyRemoteConfig: (config: {
          enabled: boolean
          intervalMinutes: number
          workStartHour: number
          workEndHour: number
          version: number
        }) => Promise<{ changed: boolean }>

        /**
         * Renderer bootstrap 完成的 ack。
         * Main 收到後會補推任何曾經失敗的 config/sync request(處理「main 早於 renderer ready」的競態)。
         */
        notifyReady: () => Promise<void>
      }

      // ─── 使用者身份同步 ──────────────────────────────────────
      userProfile: {
        /**
         * 取本機 SQLite 內的 active profile(單帳號模型下只會有 0 或 1 行)。
         * @returns UserProfile 或 null(尚未同步過)
         */
        getActive: () => Promise<UserProfile | null>

        /**
         * 寫入或更新 profile(以 userId 為 conflict target)。
         * @returns true 成功 / false 失敗
         */
        upsert: (payload: UserProfileUpsertInput) => Promise<boolean>

        /**
         * 偵測到 AD 帳號變更,通知主進程跨表清空所有 per-user 表(走 transaction)。
         * @returns true 清空成功 / false rollback
         */
        accountChangedClear: (payload: {
          oldUserId: string | null
          newUserId: string
        }) => Promise<boolean>
      }

      // ─── 認證 ───────────────────────────────────────────────
      auth: {
        /**
         * 取本機 Windows 登入帳號名（如 "jacky.chen"）。
         * 域機環境下即為 AD sAMAccountName，用於 AD 自動登入。
         * 非 Windows 平台 / 讀取失敗 → 返回空字串。
         */
        getAdAccount: () => Promise<string>

        /**
         * 以 AD 帳號名向後端換 JWT(HTTP 請求在主進程發,避開 CORS)。
         * 失敗 / 空回傳 / 超時都返回空字串,由呼叫方判定降級。
         * @param account Windows 帳號名
         * @returns JWT 字串;空字串視為失敗
         */
        adLogin: (account: string) => Promise<string>
      }

      // ─── 浮球原生右鍵菜單 ─────────────────────────────────
      /**
       * 請求主進程在光標位置彈出原生 context menu
       * 僅浮球窗口的 preload 提供此方法
       */
      showContextMenu: () => void

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
