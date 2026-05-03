/**
 * 自動更新管理器（封裝 electron-updater）。
 * 用於：electron/main/index.ts 末段 init(mainWindow)，搭配 update.handlers IPC。
 * 設計：依賴注入而非 module-level singleton，避免 import 時觸發 autoUpdater 副作用。
 */

import {autoUpdater, type ProgressInfo, type UpdateInfo} from 'electron-updater'
import {app, BrowserWindow} from 'electron'
import {logger} from './utils/logger'
import {IpcChannels} from '../shared/ipc-channels'
import type {ConfigManager} from './config-manager'
import type {WindowManager} from './window-manager'
import type {FloatingBallManager} from './floating-ball'
import type {TrayManager} from './tray-manager'

const TAG = 'UpdateManager'

export class UpdateManager {
  /** 主窗口（用於 webContents.send 推事件給渲染層） */
  private mainWindow: BrowserWindow | null = null

  /** 首次到達 HH:MM 的延時 timer */
  private firstCheckTimer: NodeJS.Timeout | null = null

  /** 之後每 24 小時觸發的 timer */
  private dailyTimer: NodeJS.Timeout | null = null

  /** 防止重複綁定 autoUpdater 事件 */
  private listenersBound = false

  /**
   * 退出清理回調，由 index.ts 注入 gracefulShutdown。
   * 避免在 update-manager 中重複退出邏輯，統一由 gracefulShutdown 管理。
   */
  private quitCallback: (() => void) | null = null

  /**
   * 注入退出清理回調。
   * 由 index.ts 在建構後呼叫，注入 gracefulShutdown 函數。
   * @param callback 退出前清理函數（gracefulShutdown）
   */
  setQuitCallback(callback: () => void): void {
    this.quitCallback = callback
  }

  /**
   * quitAndInstall 流程需要主動清理 window/tray/floatingBall，
   * 否則 hidden 主窗口 + 殘留 timer 會讓 app.quit() 卡住。
   */
  constructor(
    private readonly configManager: ConfigManager,
    private readonly windowManager: WindowManager,
    private readonly floatingBallMgr: FloatingBallManager,
    private readonly trayManager: TrayManager
  ) {}

  /**
   * 初始化 autoUpdater + 綁定事件 + 排程定時檢查。
   * 必須在 BrowserWindow 創建後 + IPC handler 註冊後呼叫。
   * @param mainWindow 主窗口實例，用於推送事件到渲染進程
   */
  init(mainWindow: BrowserWindow): void {
    this.mainWindow = mainWindow

    const cfg = this.configManager.getUpdateConfig()
    if (!cfg.enabled) {
      logger.info('自動更新已停用（update.enabled = false）', TAG)
      return
    }

    // dev 想真實檢查需打開以下行 + 在 dist/ 同層放 dev-app-update.yml
    // autoUpdater.forceDevUpdateConfig = !app.isPackaged

    autoUpdater.autoDownload = cfg.autoDownload
    autoUpdater.autoInstallOnAppQuit = cfg.autoInstallOnAppQuit
    // 服務端未提供 .blockmap，關閉差分下載避免每次先 404 fallback
    autoUpdater.disableDifferentialDownload = true
    autoUpdater.channel = cfg.channel
    autoUpdater.setFeedURL({
      provider: 'generic',
      url: cfg.feedUrl,
      channel: cfg.channel
    })

    // 把 autoUpdater 內部日誌接到專案 logger，所有更新流程進同一個檔
    autoUpdater.logger = {
      info: (msg: unknown) => logger.info(String(msg), TAG),
      warn: (msg: unknown) => logger.warn(String(msg), TAG),
      error: (msg: unknown) => logger.error(String(msg), TAG),
      debug: (msg: unknown) => logger.debug(String(msg), TAG)
    }

    if (!this.listenersBound) {
      this.bindAutoUpdaterListeners()
      this.listenersBound = true
    }

    logger.info(
      `自動更新已啟用 → feedUrl=${cfg.feedUrl} channel=${cfg.channel} ` +
      `autoDownload=${cfg.autoDownload} dailyCheckTime=${cfg.dailyCheckTime || '(關閉)'}`,
      TAG
    )

    if (cfg.dailyCheckTime) {
      this.scheduleDailyCheck(cfg.dailyCheckTime)
    } else {
      logger.info('未配置 dailyCheckTime，僅支持手動檢查', TAG)
    }

    app.once('before-quit', () => this.dispose())
  }

  /**
   * 綁定 autoUpdater 全部生命週期事件，廣播到主窗口渲染進程。
   * 渲染層通過 window.electronAPI.on('push:update-*', ...) 訂閱。
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
   * 排程每日 HH:MM 檢查（setTimeout 對齊到時點 + setInterval 24h 重複）。
   * 不直接 setInterval(24h) 是因為應用啟動時間隨用戶習慣，誤差會累積。
   * 夏令時切換等邊界情況忽略（內網企業環境影響可忽略）。
   * @param hhmm "HH:MM" 24 小時制
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
    // 已過今天的 HH:MM 就排到明天
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
      this.dailyTimer = setInterval(() => this.check(), 24 * 60 * 60 * 1000)
    }, delayMs)
  }

  /** 解析 "HH:MM"，非法回傳 null */
  private parseHHMM(s: string): { hour: number; minute: number } | null {
    const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim())
    if (!m) return null
    const hour = Number(m[1])
    const minute = Number(m[2])
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null
    return { hour, minute }
  }

  /**
   * 觸發檢查更新。
   * autoDownload=true 時自動進入下載；false 時等用戶呼叫 download()。
   * dev 模式 autoUpdater.checkForUpdates() 直接 return null 不發任何事件，
   * 會讓 UI checking spinner 卡住，這裡顯式補發 ERROR 解鎖 UI。
   */
  async check(): Promise<unknown> {
    // dev 短路：autoUpdater 不發事件，手動補一個 ERROR 讓 UI 解鎖
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
      // 雙保險：autoUpdater 內部理論上會發 'error'，這裡再補一次確保 UI 解鎖
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
   * 立即退出並安裝新版本（NSIS oneClick 無交互）。
   * 流程：gracefulShutdown（統一清理）→ 5s 保險強制 exit → quitAndInstall。
   * 主動清理是必須的，否則 hidden 主窗口 + 殘留 timer 會卡住 app.quit()。
   */
  quitAndInstall(): void {
    logger.info('用戶確認重啟安裝新版本', TAG)

    // 呼叫統一的退出清理函數，避免重複退出邏輯
    if (this.quitCallback) {
      try {
        this.quitCallback()
      } catch (err) {
        logger.error('quitAndInstall 清理階段出錯', TAG, err)
      }
    } else {
      // 回退：如果未注入回調，直接執行基本退出流程
      this.windowManager.setQuitting(true)
      try {
        this.floatingBallMgr.dispose()
        this.trayManager.destroy()
        this.windowManager.destroyAll()
      } catch (err) {
        logger.error('quitAndInstall 清理階段出錯', TAG, err)
      }
    }

    // 5 秒保險：autoUpdater 內部 app.quit() 卡住時強制 exit
    setTimeout(() => {
      logger.warn('quitAndInstall 5 秒內未退出，強制 app.exit(0)', TAG)
      app.exit(0)
    }, 5_000)

    // 參數：isSilent（不顯示 NSIS 進度框）、isForceRunAfter（裝完自動拉起）
    autoUpdater.quitAndInstall(true, true)
  }

  /** 推事件到主窗口；窗口已銷毀則靜默忽略 */
  private send(channel: string, payload?: unknown): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(channel, payload)
    }
  }

  /** 釋放 timer + 移除事件監聽 */
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
