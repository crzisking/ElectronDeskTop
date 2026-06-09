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

/**
 * 安裝階段時序常數 —— 兩條 setTimeout 一起看才有意義,放這裡讓變更時不會漏改一邊。
 *
 * SHUTDOWN_TO_INSTALL_DELAY_MS
 *   gracefulShutdown 同步跑完後,Windows 還需要一小段時間才會真的釋放檔案 handle
 *   (DB WAL flush、子視窗 GPU 進程退出、tray 圖示銷毀等)。立刻呼叫 autoUpdater.quitAndInstall
 *   會讓 NSIS installer 跟仍持有 .exe / .node 的舊 process 搶檔案,Windows 拒絕寫入 →
 *   NSIS 中止 → 使用者看到「fail」彈窗。
 *   1500ms 是經驗值,800ms 實測偶發失敗,1500ms 穩。
 *
 * FORCE_EXIT_FALLBACK_MS
 *   萬一 autoUpdater 內部 app.quit() 卡住的最後兜底。必須在 SHUTDOWN_TO_INSTALL_DELAY_MS
 *   之後足夠久,讓 NSIS spawn 已經完成才強制 exit,否則反而打斷 installer 啟動。
 */
const SHUTDOWN_TO_INSTALL_DELAY_MS = 1_500
const FORCE_EXIT_FALLBACK_MS = 8_000

/**
 * 把 "x.y.z" / "x.y.z-rc.1" 切成可比較的 tuple。
 * 規則對齊 semver:pre-release 版本 < 同號正式版(2.0.0-rc.1 < 2.0.0)。
 *
 * 為什麼自己寫而不引 semver:電腦上的 semver 是 electron-updater 的 transitive dep,
 * 我們沒在 package.json 直接宣告;直接 import 等於賭它永遠在依賴樹上,以後升 electron-updater
 * 一旦它換掉就裂。這裡只需要「嚴格大於」就能擋 downgrade,自己寫一個夠用。
 *
 * @returns [major, minor, patch, hasPreRelease(0=正式, 1=pre)]
 *   pre-release 內部細節不比,只用 0/1 區分 —— pre 永遠小於正式。
 *   解析失敗回 null,呼叫端視同「無法判斷,保守拒絕」。
 */
function parseVersion(v: string): [number, number, number, number] | null {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-.+)?$/.exec(v.trim())
  if (!m) return null
  const major = Number(m[1])
  const minor = Number(m[2])
  const patch = Number(m[3])
  if (!Number.isFinite(major) || !Number.isFinite(minor) || !Number.isFinite(patch)) return null
  const hasPre = v.includes('-') ? 1 : 0
  // 正式版 hasPre=0,pre 版 hasPre=1;比較時希望「正式 > pre」,所以最後那位用「-hasPre」反過來
  return [major, minor, patch, -hasPre]
}

/** 嚴格大於:server > current 才算新版,平手或更舊都回 false */
function isStrictlyNewer(serverVersion: string, currentVersion: string): boolean {
  const s = parseVersion(serverVersion)
  const c = parseVersion(currentVersion)
  if (!s || !c) return false
  for (let i = 0; i < 4; i++) {
    if (s[i] > c[i]) return true
    if (s[i] < c[i]) return false
  }
  return false
}

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

    // autoDownload 永遠交給我們自己的 update-available handler 把關;
    // electron-updater 內建 autoDownload 一旦 fire 就無路可退,沒辦法在中間插驗證。
    // 我們把它鎖在 false,handler 內 guard 通過後再呼叫 downloadUpdate()。
    // 對外行為(config.autoDownload=true 時看見有新版自動下載)透過 handler 邏輯保持一致。
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = cfg.autoInstallOnAppQuit
    // 服務端未提供 .blockmap，關閉差分下載避免每次先 404 fallback
    autoUpdater.disableDifferentialDownload = true
    autoUpdater.channel = cfg.channel
    // ⚠ 重要:electron-updater 的 channel setter 會把 allowDowngrade 偷偷翻成 true
    // (見 node_modules/electron-updater/out/AppUpdater.js channel setter)。
    // 它的原意是「使用者切 channel 通常是想回穩定版」,但對我們這種 channel 固定 'latest'
    // 的場景純屬副作用 —— 會導致 server 上的 latest.yml 寫了比 client 還舊的版本時,
    // client 仍然把舊版本下載下來重裝(downgrade)。
    // 必須在設完 channel 後**顯式**關掉,順序不能反。
    autoUpdater.allowDowngrade = false
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
      const current = app.getVersion()

      // 第二道防線:即使 SDK 內部 allowDowngrade 行為又有變,我們自己再嚴格比一次。
      // electron-updater 預設 allowDowngrade=false,加上 init 時已顯式關掉 channel
      // setter 的副作用,理論上不會走到這個 guard,但保留可防未來 SDK 升級偷偷改行為。
      if (!isStrictlyNewer(info.version, current)) {
        logger.warn(
            `收到 update-available 但 server 版本 ${info.version} 不嚴格大於當前 ${current},拒絕下載`,
            TAG
        )
        // 對 UI 直接報「已是最新版」,別讓使用者看到「發現新版本」的誤導通知
        this.send(IpcChannels.PUSH_UPDATE_NOT_AVAILABLE)
        return
      }

      logger.info(`發現新版本 ${info.version}(當前 ${current})`, TAG)
      this.send(IpcChannels.PUSH_UPDATE_AVAILABLE, {
        version: info.version,
        releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : undefined,
        releaseDate: info.releaseDate
      })

      // autoDownload 被我們鎖在 false,所以這裡依 config 決定要不要自動啟動下載,
      // 維持 UpdateConfig.autoDownload 的對外語義(true=發現新版立刻背景下載)。
      const cfg = this.configManager.getUpdateConfig()
      if (cfg.autoDownload) {
        autoUpdater.downloadUpdate().catch((err) => {
          // downloadUpdate 自己也會 emit 'error',這裡只 log,避免 UI 收到兩次錯誤通知
          logger.error('downloadUpdate 失敗', TAG, err)
        })
      }
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
        // autoUpdater 內部 checkForUpdates reject 時也會 emit 'error' 事件 → on('error')
        // handler 統一推 PUSH_UPDATE_ERROR。這裡不再手動 send,避免 UI 收到雙錯誤 toast。
        // 之前的「雙保險」假設證實為 over-engineering,實測 autoUpdater 一定會發。
      logger.error('checkForUpdates 失敗', TAG, err)
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
   * 立即退出並安裝新版本(NSIS oneClick 無交互)。
   *
   * 流程分三段,時序故意拉開:
   *   ① 同步清理(gracefulShutdown):DB close / 視窗 destroy / 子模組 dispose
   *   ② 排定強制退出兜底(FORCE_EXIT_FALLBACK_MS):極端情況下確保 app 一定退
   *   ③ 延遲呼叫 autoUpdater.quitAndInstall(SHUTDOWN_TO_INSTALL_DELAY_MS):
   *      讓 Windows 真正釋放 .exe / .node 等檔案 handle,NSIS 才能成功替換
   *
   * 早期版本是「①+②+立即③」,實測會出現「NSIS 安裝失敗 → 使用者看到 fail 彈窗 →
   * 重新打開又下載一次才裝成功」的競態。詳見 SHUTDOWN_TO_INSTALL_DELAY_MS 常數註解。
   */
  quitAndInstall(): void {
    logger.info('用戶確認重啟安裝新版本', TAG)

    // ① 同步清理 — 主路徑走注入的 gracefulShutdown,回退路徑只 dispose 三個關鍵 manager
    if (this.quitCallback) {
      try {
        this.quitCallback()
      } catch (err) {
        logger.error('quitAndInstall 清理階段出錯', TAG, err)
      }
    } else {
      this.windowManager.setQuitting(true)
      try {
        this.floatingBallMgr.dispose()
        this.trayManager.destroy()
        this.windowManager.destroyAll()
      } catch (err) {
        logger.error('quitAndInstall 清理階段出錯', TAG, err)
      }
    }

    // ② 強制退出兜底:autoUpdater.quitAndInstall 內部理論上會呼 app.quit(),
    //    但若卡住(殘留 timer / 監聽器),這條保險踢 app.exit(0)。
    //    時序在 ③ 之後 ~6.5 秒,確保 NSIS spawn 完成才生效。
    setTimeout(() => {
      logger.warn(`quitAndInstall ${FORCE_EXIT_FALLBACK_MS}ms 內未退出,強制 app.exit(0)`, TAG)
      app.exit(0)
    }, FORCE_EXIT_FALLBACK_MS)

    // ③ 延遲呼叫 autoUpdater.quitAndInstall —— Windows 需要時間真正釋放檔案 handle,
    //    否則 NSIS 跟舊 process 搶檔案會被擋。
    //    參數:isSilent(不顯示 NSIS 進度框)、isForceRunAfter(裝完自動拉起)
    setTimeout(() => {
      try {
        logger.info('開始呼叫 autoUpdater.quitAndInstall(silent=true, runAfter=true)', TAG)
        autoUpdater.quitAndInstall(true, true)
      } catch (err) {
        // SDK 同步拋出極罕見,但要兜住 —— 否則使用者看到「fail」彈窗時,我們完全沒紀錄。
        // 此時 DB 已 close,logger.error 走 .txt 檔(<userData>/logs/main-YYYY-MM-DD.log)。
        logger.error('autoUpdater.quitAndInstall 同步異常', TAG, err)
      }
    }, SHUTDOWN_TO_INSTALL_DELAY_MS)
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
