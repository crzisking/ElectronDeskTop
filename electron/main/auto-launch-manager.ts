/**
 * 開機自動啟動管理器。
 *
 * 用途:強制將「Windows 登入時自動啟動本 app」寫入 OS。
 *      公司內部工具預期 → Windows 登入 → app 自動啟動 → 直接顯示主窗
 *      (跟使用者雙擊圖標的啟動流程完全一致,不帶任何特殊參數)。
 *
 * 為什麼不提供開關:
 *  - 公司軟體政策 — 必須開機自啟,不允許使用者關閉
 *  - 若使用者手動到工作管理員 / 設定 → 啟動 中停用,
 *    下一次 app 被任何方式啟動時 ensureAutoLaunchRegistered() 會再寫回,持續生效
 *
 * 卸載清理:由 NSIS uninstall 段負責(刪除對應 HKCU\...\Run 鍵)。
 * 此模組不處理卸載時的清理,因為 app 已被刪除,跑不到這段 JS。
 *
 * 寫入位置(Windows):
 *   HKCU\Software\Microsoft\Windows\CurrentVersion\Run
 *     Value name: 應用 productName (= package.json build.productName = "ichiaDesktop")
 *     Value data: 安裝後的 exe 絕對路徑
 *   per-user 範圍,不需管理員權限。
 */

import {app} from 'electron'
import {logger} from './utils/logger'

/**
 * 強制將開機自啟設定寫入 OS。
 *
 * 在 app.whenReady() 後呼叫一次即可。idempotent — 重複呼叫不會出問題,
 * Electron 內部會更新註冊表項(若 exe 路徑變了也會自動同步)。
 *
 * 失敗情境(GPO 鎖定、權限被收回等)只記錄 warn,不影響 app 啟動流程。
 */
export function ensureAutoLaunchRegistered(): void {
  // 攜帶版(portable.exe)解壓位置不固定,寫了下次又失效,跳過
  if (process.env.PORTABLE_EXECUTABLE_DIR) {
    logger.debug('Portable 版本不註冊開機自啟', 'AutoLaunch')
    return
  }

  // Dev 模式不寫,避免污染開發機的 Run 鍵
  if (!app.isPackaged) {
    logger.debug('Dev 環境不註冊開機自啟', 'AutoLaunch')
    return
  }

  // 僅在 Windows 上做事;macOS / Linux 留給未來需要時再擴
  if (process.platform !== 'win32') {
    logger.debug(`非 Windows 平台 (${process.platform}),跳過開機自啟註冊`, 'AutoLaunch')
    return
  }

  try {
    app.setLoginItemSettings({openAtLogin: true})
    const current = app.getLoginItemSettings()
    logger.info(
        `開機自啟已註冊 (openAtLogin=${current.openAtLogin}, executableWillLaunchAtLogin=${current.executableWillLaunchAtLogin})`,
        'AutoLaunch'
    )
  } catch (err) {
    // GPO 鎖定 / 防毒攔截 / 權限問題等 — 不影響啟動,只記錄供排查
    logger.warn('開機自啟註冊失敗', 'AutoLaunch', err as Error)
  }
}
