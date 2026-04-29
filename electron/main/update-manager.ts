/**
 * UpdateManager — 自動更新管理器（封裝 electron-updater）
 *
 * ── 職責 ─────────────────────────────────────────────────────────────
 * 1. 啟動時根據 ConfigManager.getUpdateConfig() 配置 autoUpdater
 * 2. 安排「每日定時檢查」（HH:MM，例如 11:00）+ 應用退出時清理 timer
 * 3. 監聽 autoUpdater 全部生命週期事件，廣播到主窗口渲染進程
 * 4. 對外暴露 check / download / quitAndInstall 給 IPC handler 呼叫
 *
 * ── 設計選擇 ─────────────────────────────────────────────────────────
 * - 走「依賴注入」風格，constructor 接收 ConfigManager 實例（與專案其他
 *   manager 一致：FloatingBallManager、TrayManager 都這樣寫）
 * - 不寫成 module-level singleton（如 export const updateMgr = ...），
 *   避免在 import 時就觸發 electron-updater 的副作用初始化
 * - 日誌復用專案現有 logger，不引入 electron-log（避免雙重日誌堆疊）
 *
 * ── 每日定時檢查實作 ─────────────────────────────────────────────────
 * 用 setTimeout 計算「現在 → 下一次到達 HH:MM」的毫秒差，到時間後
 * 觸發一次 check()，再用 setInterval 每 24 小時重複。
 *
 * 為什麼不用 setInterval 直接每 24 小時跑：
 *   無法保證對齊到 HH:MM；應用啟動時間隨用戶習慣，可能變成「每天用戶
 *   開機後 + 24h」，誤差會累積。
 */

import { autoUpdater, type UpdateInfo, type ProgressInfo } from 'electron-updater'
import { BrowserWindow, app } from 'electron'
import { logger } from './utils/logger'
import { IpcChannels } from '../shared/ipc-channels'
import type { ConfigManager } from './config-manager'

const TAG = 'UpdateManager'

export class UpdateManager {
  /** 主窗口引用（用於 webContents.send 推送事件給渲染層） */
  private mainWindow: BrowserWindow | null = null

  /** 首次到達 HH:MM 的延時 timer */
  private firstCheckTimer: NodeJS.Timeout | null = null

  /** 之後每 24 小時觸發的 timer */
  private dailyTimer: NodeJS.Timeout | null = null

  /** 是否已綁定 autoUpdater 事件，避免重複綁定 */
  private listenersBound = false

  constructor(private readonly configManager: ConfigManager) {}

  /**
   * 初始化自動更新管理器
   * 必須在 BrowserWindow 創建後 + IPC handler 註冊後呼叫。
   *
   * @param mainWindow 主窗口實例，用於推送事件到渲染進程
   */
  init(mainWindow: BrowserWindow): void {
    this.mainWindow = mainWindow

    const cfg = this.configManager.getUpdateConfig()
    if (!cfg.enabled) {
      logger.info('自動更新已停用（update.enabled = false）', TAG)
      return
    }

    // 開發模式下 electron-updater 默認跳過，這裡可放開做本機驗證：
    // 啟用後需在 dist/ 同層放 dev-app-update.yml，或 forceDevUpdateConfig=true
    // autoUpdater.forceDevUpdateConfig = !app.isPackaged

    // ── 1. 應用 autoUpdater 配置 ────────────────────────────────
    autoUpdater.autoDownload = cfg.autoDownload
    autoUpdater.autoInstallOnAppQuit = cfg.autoInstallOnAppQuit
    autoUpdater.channel = cfg.channel
    autoUpdater.setFeedURL({
      provider: 'generic',
      url: cfg.feedUrl,
      channel: cfg.channel
    })

    // 把 electron-updater 的 logger 接到專案 logger 上，所有更新流程日誌
    // 都會走 utils/logger 的格式化通道。autoUpdater.logger 接口要求
    // info/warn/error/debug 四個方法，shape 與我們的 logger 兼容。
    autoUpdater.logger = {
      info: (msg: unknown) => logger.info(String(msg), TAG),
      warn: (msg: unknown) => logger.warn(String(msg), TAG),
      error: (msg: unknown) => logger.error(String(msg), TAG),
      debug: (msg: unknown) => logger.debug(String(msg), TAG)
    }

    // ── 2. 綁定生命週期事件（一次性） ────────────────────────
    if (!this.listenersBound) {
      this.bindAutoUpdaterListeners()
      this.listenersBound = true
    }

    logger.info(
      `自動更新已啟用 → feedUrl=${cfg.feedUrl} channel=${cfg.channel} ` +
      `autoDownload=${cfg.autoDownload} dailyCheckTime=${cfg.dailyCheckTime || '(關閉)'}`,
      TAG
    )

    // ── 3. 排程每日定時檢查 ─────────────────────────────────
    if (cfg.dailyCheckTime) {
      this.scheduleDailyCheck(cfg.dailyCheckTime)
    } else {
      logger.info('未配置 dailyCheckTime，僅支持手動檢查', TAG)
    }

    // 應用退出前清理 timer + 監聽器
    app.once('before-quit', () => this.dispose())
  }

  /**
   * 綁定 autoUpdater 生命週期事件，全部廣播到主窗口渲染進程。
   * 渲染層通過 window.electronAPI.update.onXxx(...) 註冊回調。
   */
  private bindAutoUpdaterListeners(): void {
    autoUpdater.on('checking-for-update', () => {
      this.send(IpcChannels.PUSH_UPDATE_CHECKING)
    })

    autoUpdater.on('update-available', (info: UpdateInfo) => {
      logger.info(`發現新版本 ${info.version}`, TAG)
      this.send(IpcChannels.PUSH_UPDATE_AVAILABLE, {
        version: info.version,
        releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : undefined,
        releaseDate: info.releaseDate
      })
    })

    autoUpdater.on('update-not-available', () => {
      this.send(IpcChannels.PUSH_UPDATE_NOT_AVAILABLE)
    })

    autoUpdater.on('download-progress', (p: ProgressInfo) => {
      this.send(IpcChannels.PUSH_UPDATE_PROGRESS, {
        percent: p.percent,
        bytesPerSecond: p.bytesPerSecond,
        transferred: p.transferred,
        total: p.total
      })
    })

    autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
      logger.info(`新版本 ${info.version} 已下載完成，等待用戶確認重啟`, TAG)
      this.send(IpcChannels.PUSH_UPDATE_DOWNLOADED, { version: info.version })
    })

    autoUpdater.on('error', (err) => {
      const message = err?.message ?? String(err)
      logger.error(`autoUpdater error: ${message}`, TAG)
      this.send(IpcChannels.PUSH_UPDATE_ERROR, { message })
    })
  }

  /**
   * 安排「每日 HH:MM 檢查更新」。
   * 計算現在到下一次 HH:MM 的毫秒差，setTimeout 觸發後再用 setInterval
   * 每 24 小時重複；夏令時切換等邊界情況忽略（內網企業環境影響可忽略）。
   *
   * @param hhmm 目標時刻字串，格式 "HH:MM"（24 小時制）
   */
  private scheduleDailyCheck(hhmm: string): void {
    const parsed = this.parseHHMM(hhmm)
    if (!parsed) {
      logger.warn(`dailyCheckTime 格式無效："${hhmm}"，預期 HH:MM`, TAG)
      return
    }

    const { hour, minute } = parsed
    const now = new Date()
    const next = new Date(now)
    next.setHours(hour, minute, 0, 0)
    // 已過今天的 HH:MM → 排到明天
    if (next.getTime() <= now.getTime()) {
      next.setDate(next.getDate() + 1)
    }

    const delayMs = next.getTime() - now.getTime()
    logger.info(
      `首次定時檢查將於 ${next.toLocaleString()} 觸發（約 ${Math.round(delayMs / 60000)} 分鐘後）`,
      TAG
    )

    this.firstCheckTimer = setTimeout(() => {
      this.check()
      // 之後每 24 小時跑一次
      this.dailyTimer = setInterval(() => this.check(), 24 * 60 * 60 * 1000)
    }, delayMs)
  }

  /** 解析 "HH:MM" 字串為 { hour, minute }；非法則回傳 null */
  private parseHHMM(s: string): { hour: number; minute: number } | null {
    const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim())
    if (!m) return null
    const hour = Number(m[1])
    const minute = Number(m[2])
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null
    return { hour, minute }
  }

  // ─── 對外 API（由 IPC handler 呼叫） ─────────────────────────────

  /**
   * 檢查是否有更新。
   * autoDownload=true 時會自動進入下載階段；
   * autoDownload=false 時觸發 update-available 後等用戶呼叫 download()。
   *
   * ── 開發模式特殊處理 ──────────────────────────────────────────────
   * autoUpdater.checkForUpdates() 在 app.isPackaged === false 時
   * 會直接 return null 並打印 "Skip checkForUpdates because application
   * is not packed and dev update config is not forced"，**不會發任何事件**，
   * 導致渲染端的「檢查中…」狀態永遠不會被清除（spinner 卡住）。
   *
   * 為了讓開發者能在 dev 環境測試 UI 流程，這裡顯式發送一個 ERROR 事件，
   * 提示「開發模式下無法檢查更新」，UI 就能脫離 checking 狀態。
   *
   * 若想在 dev 真實檢查，需打開 update-manager.ts 中的
   *   autoUpdater.forceDevUpdateConfig = !app.isPackaged
   * 並在專案根目錄放 dev-app-update.yml。
   */
  async check(): Promise<unknown> {
    // dev 模式短路：autoUpdater 不發事件，這裡手動補一個 ERROR 讓 UI 解鎖
    if (!app.isPackaged && !autoUpdater.forceDevUpdateConfig) {
      const message = '開發模式下無法檢查更新（請打包後測試，或啟用 forceDevUpdateConfig）'
      logger.warn(message, TAG)
      this.send(IpcChannels.PUSH_UPDATE_ERROR, { message })
      return null
    }

    try {
      logger.info('開始檢查更新…', TAG)
      return await autoUpdater.checkForUpdates()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logger.error('checkForUpdates 失敗', TAG, err)
      // 主動補發一個 ERROR 事件確保 UI 一定解鎖
      // （autoUpdater 內部理論上會發 'error' 事件，這裡是雙保險）
      this.send(IpcChannels.PUSH_UPDATE_ERROR, { message })
      return undefined
    }
  }

  /** 手動觸發下載（autoDownload=false 場景使用） */
  async download(): Promise<unknown> {
    try {
      return await autoUpdater.downloadUpdate()
    } catch (err) {
      logger.error('downloadUpdate 失敗', TAG, err)
      throw err
    }
  }

  /**
   * 立即退出並安裝。
   * 配合 NSIS oneClick=true 模式，安裝過程無交互窗口，靜默完成後拉起新版。
   */
  quitAndInstall(): void {
    logger.info('用戶確認重啟安裝新版本', TAG)
    autoUpdater.quitAndInstall()
  }

  // ─── 內部工具 ───────────────────────────────────────────────────

  /** 推送事件到主窗口渲染進程（窗口已關閉/銷毀則靜默忽略） */
  private send(channel: string, payload?: unknown): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(channel, payload)
    }
  }

  /** 釋放資源：清 timer + 移除事件 */
  dispose(): void {
    if (this.firstCheckTimer) {
      clearTimeout(this.firstCheckTimer)
      this.firstCheckTimer = null
    }
    if (this.dailyTimer) {
      clearInterval(this.dailyTimer)
      this.dailyTimer = null
    }
    if (this.listenersBound) {
      autoUpdater.removeAllListeners()
      this.listenersBound = false
    }
    logger.info('UpdateManager 已釋放', TAG)
  }
}
