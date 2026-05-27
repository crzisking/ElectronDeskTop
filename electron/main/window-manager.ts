/**
 * 集中管理主窗口 + 浮球窗口的狀態機。
 * 用於：electron/main/index.ts 啟動時建構，IPC handler / TrayManager / UpdateManager 都會引用。
 * 狀態：主窗口顯示 ←→ 主窗口隱藏 + 浮球顯示。
 */

import {app, BrowserWindow, screen} from 'electron'
import {join} from 'path'
import {logger} from './utils/logger'
import {safeOpenExternal} from './utils/safe-shell'
import {resolveResourcePath} from './utils/resources-path'

const isDev = !app.isPackaged

/**
 * 應用圖標(Windows 任務欄、窗口標題欄使用)。
 * 走 resolveResourcePath:
 *  - dev:  <projectRoot>/resources/icons/icon.ico
 *  - prod: <install>/resources/resources/icons/icon.ico
 * 原本用 `__dirname + '../../resources/...'` 在 prod 會指向 app.asar 內部找不到。
 */
const appIconPath = resolveResourcePath('icons', 'icon.ico')

export class WindowManager {
  private mainWindow: BrowserWindow | null = null

  /** 浮球窗口應用生命週期內持久存在，僅 show/hide 切換 */
  private floatingBallWindow: BrowserWindow | null = null

  /** 日誌查看器子視窗(密碼解鎖後才開,關閉即銷毀,下次開重建) */
  private logViewerWindow: BrowserWindow | null = null

  /** AI Agent 獨立窗口(關閉即銷毀,下次開重建) */
  private agentWindow: BrowserWindow | null = null

  /**
   * 是否進入「應用退出中」狀態。
   * true 後主窗口的 close 事件不再 preventDefault，讓窗口正常關閉。
   * 用於：UpdateManager.quitAndInstall 和托盤「結束應用程式」流程。
   */
  private isQuitting = false

  /** 設置退出中標記（quitAndInstall / 托盤退出時呼叫） */
  setQuitting(value: boolean): void {
    this.isQuitting = value
  }

  /**
   * 建立主窗口。
   * show:false + ready-to-show 才顯示，避免加載期間白閃。
   * close 事件被攔截為 hide，除非 isQuitting=true。
   */
  createMainWindow(): BrowserWindow {
    this.mainWindow = new BrowserWindow({
      width: 1200,
      height: 800,
      minWidth: 960,
      minHeight: 620,
      icon: appIconPath,
      // 自定義標題欄在 Vue 中渲染
      frame: false,
      // ready-to-show 後才顯示，防白閃
      show: false,
      backgroundColor: '#f3f4f6',
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        // 啟用 Chromium 沙箱：即使 XSS 突破 contextBridge，也無法直接拿到主進程權限。
        // 本專案 preload 只用 contextBridge + ipcRenderer，未調用 require('fs') 等
        // 需 Node 能力的 API，可以開啟沙箱。
        sandbox: true,
        devTools: isDev
      }
    })

    if (isDev && process.env['ELECTRON_RENDERER_URL']) {
      this.mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
    } else {
      this.mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
    }

    this.mainWindow.once('ready-to-show', () => {
      if (!this.mainWindow) return
      this.mainWindow.show()
      if (isDev) {
        this.mainWindow.webContents.openDevTools({ mode: 'detach' })
      }
      logger.info('主窗口已顯示', 'WindowManager')
    })

    // 點 × 攔截為隱藏 + 顯示浮球；isQuitting=true 時放行讓 app.quit() 不卡住
    this.mainWindow.on('close', (event) => {
      if (this.isQuitting) return
      event.preventDefault()
      this.hideMainWindow()
      logger.debug('主窗口 close 事件被攔截，切換為浮球模式', 'WindowManager')
    })

    // 通知渲染進程更新標題欄最大化按鈕狀態
    this.mainWindow.on('maximize', () => {
      this.mainWindow?.webContents.send('push:window-maximized', true)
    })
    this.mainWindow.on('unmaximize', () => {
      this.mainWindow?.webContents.send('push:window-maximized', false)
    })

    // 外部鏈接導向系統瀏覽器，不在 Electron 內開新窗口
    // 走 safeOpenExternal 過濾 javascript: / file:// 等危險協議
    this.mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      safeOpenExternal(url)
      return { action: 'deny' }
    })

    logger.info('主窗口已創建', 'WindowManager')
    return this.mainWindow
  }

  /**
   * 建立浮球窗口（透明、置頂、無邊框、不可調整大小）。
   * 默認隱藏，由 hideMainWindow() 觸發顯示。
   * 必須 transparent + frame:false 才能呈現圓形浮球外觀。
   */
  createFloatingBallWindow(): BrowserWindow {
    // 視窗緊貼球體外接正方形（80×80），不留 padding。
    // 已去掉 box-shadow，沒有半透明陰影需要緩衝邊；同時最小化四角透明區，
    // 拖動時 Windows DWM 不會把多餘的透明矩形描出來。
    this.floatingBallWindow = new BrowserWindow({
      width: 80,
      height: 80,
      frame: false,
      // 透明配合 CSS border-radius 呈現圓形
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      hasShadow: false,
      show: false,
      focusable: false,
      webPreferences: {
        preload: join(__dirname, '../preload/floatingBall.js'),
        contextIsolation: true,
        nodeIntegration: false,
        // 浮球 preload 同樣只用 contextBridge + ipcRenderer，可開沙箱
        sandbox: true
      }
    })

    // Windows 用 screen-saver 級別防止被全屏窗口遮擋
    if (process.platform === 'win32') {
      this.floatingBallWindow.setAlwaysOnTop(true, 'screen-saver')
    } else if (process.platform === 'darwin') {
      this.floatingBallWindow.setAlwaysOnTop(true, 'floating')
    }

    if (isDev && process.env['ELECTRON_RENDERER_URL']) {
      // electron-vite dev server 根目錄為 src/，路徑不含 src 前綴
      this.floatingBallWindow.loadURL(
        `${process.env['ELECTRON_RENDERER_URL']}/floating-ball.html`
      )
    } else {
      this.floatingBallWindow.loadFile(
        join(__dirname, '../renderer/floating-ball.html')
      )
    }

    this.floatingBallWindow.once('ready-to-show', () => {
      logger.info('浮球窗口已就緒', 'WindowManager')
    })

    logger.info('浮球窗口已創建', 'WindowManager')
    return this.floatingBallWindow
  }

  /**
   * 建立日誌查看器子視窗。
   *
   * 跟主窗 / 浮球窗都不一樣:
   *  - 不持久化,關閉即銷毀,下次重新建。避免閒置時占資源
   *  - 用獨立 preload (`log-viewer.preload.js`),只暴露 logQuery 一個 IPC
   *  - 大尺寸 + frame:true 沿用系統標題欄,管理員看著舒服
   *
   * 呼叫前主進程已驗過解鎖狀態(見 log-viewer.handlers.ts),這裡不再重複驗。
   */
  createLogViewerWindow(): BrowserWindow {
    // 已存在 → 拉到前台聚焦,不重建
    if (this.logViewerWindow && !this.logViewerWindow.isDestroyed()) {
      this.logViewerWindow.show()
      this.logViewerWindow.focus()
      return this.logViewerWindow
    }

    this.logViewerWindow = new BrowserWindow({
      width: 1100,
      height: 720,
      minWidth: 900,
      minHeight: 500,
      icon: appIconPath,
      title: '日誌查看器',
      // 用系統原生標題欄,管理員工具不需要花哨 UI
      frame: true,
      show: false,
      backgroundColor: '#f3f4f6',
      // 主窗的子視窗,主窗最小化時它也跟著消失(避免遺留視窗)
      parent: this.mainWindow ?? undefined,
      webPreferences: {
        preload: join(__dirname, '../preload/log-viewer.preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        devTools: isDev,
      },
    })

    if (isDev && process.env['ELECTRON_RENDERER_URL']) {
      this.logViewerWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/log-viewer.html`)
    } else {
      this.logViewerWindow.loadFile(join(__dirname, '../renderer/log-viewer.html'))
    }

    this.logViewerWindow.once('ready-to-show', () => {
      this.logViewerWindow?.show()
      if (isDev) {
        this.logViewerWindow?.webContents.openDevTools({mode: 'detach'})
      }
      logger.info('日誌查看器已開啟', 'WindowManager')
    })

    // 關閉後清空引用,下次開啟重建
    this.logViewerWindow.on('closed', () => {
      this.logViewerWindow = null
      logger.info('日誌查看器已關閉', 'WindowManager')
    })

    return this.logViewerWindow
  }

  /** 顯示主窗口、隱藏浮球 */
  showMainWindow(): void {
    if (!this.mainWindow) return
    this.mainWindow.show()
    this.mainWindow.focus()
    this.floatingBallWindow?.hide()
    logger.debug('顯示主窗口，隱藏浮球', 'WindowManager')
  }

  /** 隱藏主窗口、顯示浮球 */
  hideMainWindow(): void {
    if (!this.mainWindow) return
    this.mainWindow.hide()
    this.showFloatingBall()
    logger.debug('隱藏主窗口，顯示浮球', 'WindowManager')
  }

  showFloatingBall(): void {
    if (!this.floatingBallWindow) return
    this.floatingBallWindow.show()
  }

  hideFloatingBall(): void {
    this.floatingBallWindow?.hide()
  }

  getMainWindow(): BrowserWindow | null {
    return this.mainWindow
  }

  /** 取浮球窗口（供 FloatingBallManager 操作位置） */
  getFloatingBallWindow(): BrowserWindow | null {
    return this.floatingBallWindow
  }

  /** 向主窗口渲染進程發送消息 */
  sendToMainWindow(channel: string, ...args: unknown[]): void {
    this.mainWindow?.webContents.send(channel, ...args)
  }

  /**
   * 取浮球當前位置。
   * @returns { x, y } 屏幕座標
   */
  getFloatingBallPosition(): { x: number; y: number } {
    if (!this.floatingBallWindow) return { x: 100, y: 300 }
    const [x, y] = this.floatingBallWindow.getPosition()
    return { x, y }
  }

  /**
   * 設置浮球位置（會校驗顯示器邊界）。
   *
   * 邊界校驗邏輯：
   *  1. 先用 (x, y) 與所有 display 的 workArea 比對。
   *     若浮球的左上角座標仍落在某個 display 的 workArea 內 → 認為合法,僅做該 display 內的 clamp。
   *  2. 若不在任何 display 內（典型場景：上次配置時是雙屏，現在拔掉了副屏），
   *     直接放到主屏右下角，距離邊距 80px，避免首次顯示在屏外瞬閃。
   *
   * @param x 目標 X 座標
   * @param y 目標 Y 座標
   * @param ballSize 浮球大小（用於計算邊界，默認 80 與窗口/CSS 一致）
   */
  setFloatingBallPosition(x: number, y: number, ballSize = 80): void {
    if (!this.floatingBallWindow) return

    // 找到 (x, y) 落入的 display；若都不在,fallback 到主屏
    const displays = screen.getAllDisplays()
    const containing = displays.find((d) => {
      const {x: dx, y: dy, width: dw, height: dh} = d.workArea
      return x >= dx && x <= dx + dw - ballSize && y >= dy && y <= dy + dh - ballSize
    })

    if (containing) {
      // 在某 display 內，僅在該 display 內做 clamp（避免邊緣輕微越界）
      const {x: dx, y: dy, width: dw, height: dh} = containing.workArea
      const clampedX = Math.max(dx, Math.min(x, dx + dw - ballSize))
      const clampedY = Math.max(dy, Math.min(y, dy + dh - ballSize))
      this.floatingBallWindow.setPosition(clampedX, clampedY)
      return
    }

    // 任一 display 都不包含，說明顯示器拓撲變了。塞主屏右下角，離邊 80px。
    const primary = screen.getPrimaryDisplay().workArea
    const fallbackX = primary.x + primary.width - ballSize - 80
    const fallbackY = primary.y + primary.height - ballSize - 80
    logger.warn(
        `浮球默認位置 (${x}, ${y}) 不在任何顯示器內，改塞主屏右下角 (${fallbackX}, ${fallbackY})`,
        'WindowManager'
    )
    this.floatingBallWindow.setPosition(fallbackX, fallbackY)
  }

  /**
   * 在新 Electron 子窗口打開指定 URL（openMode='electron-window' 用）。
   * 不受 iframe X-Frame-Options 限制；保持在應用內；關閉時自動銷毀。
   * 安全：只允許加載白名單域名內的 URL，防止渲染進程打開任意網址。
   * @param url            要加載的系統 URL
   * @param title          窗口標題
   * @param allowedDomains 允許加載的域名白名單（從 app-config.json 的系統列表提取）
   */
  openChildWindow(url: string, title: string, allowedDomains: string[] = []): BrowserWindow {
    const child = new BrowserWindow({
      width: 1200,
      height: 800,
      title,
      icon: appIconPath,
      // 子窗口用系統原生標題欄
      frame: true,
      autoHideMenuBar: true,
      webPreferences: {
        // 子窗口不需要 Node.js 能力
        contextIsolation: true,
        nodeIntegration: false,
        // 注意：子窗口故意不用 sandbox: true。
        // 雖然主窗口/浮球用 sandbox: true 多一層 XSS 防護，但子窗口：
        //   1. 沒有 preload 腳本，沒有 contextBridge 暴露任何能力給網頁，sandbox: true 沒有額外收益
        //   2. 加載 ERP / BI / BPM 等複雜內網系統，它們依賴完整 cookie / fetch / SessionStorage
        //      OS 級沙箱進程在某些頁面下會出現「一片空白、無報錯」現象（瀏覽器級別的資源加載被限制）
        // 因此這裡顯式設為 false，與「網頁是受信任內網系統」的場景對齊。
        sandbox: false,
      },
    })

    // 徹底去掉 File/Edit 系統菜單
    child.setMenuBarVisibility(false)
    child.removeMenu()

    // 安全校驗：解析 URL 並檢查域名是否在白名單內
    // 白名單為空時拒絕所有 URL（防止未配置白名單時的安全漏洞）
    let parsedUrl: URL
    try {
      parsedUrl = new URL(url)
    } catch {
      logger.warn(`子窗口 URL 格式無效，拒絕打開: ${url}`, 'WindowManager')
      child.close()
      return child
    }

    if (!allowedDomains.includes(parsedUrl.hostname)) {
      logger.warn(`子窗口 URL 域名不在白名單內，拒絕打開: ${parsedUrl.hostname}`, 'WindowManager')
      child.close()
      return child
    }

    // did-fail-load：頁面整體加載失敗時記錄具體錯誤碼，方便排查空白窗口問題
    // errorCode 常見值：-3 (ABORTED, 通常是用戶取消，可忽略)、-105 (NAME_NOT_RESOLVED)、
    //   -106 (INTERNET_DISCONNECTED)、-118 (CONNECTION_TIMED_OUT)、-501 (INSECURE_RESPONSE)
    child.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      // -3 是用戶主動取消（例如關窗），不算真正的錯誤
      if (errorCode === -3 || !isMainFrame) return
      logger.error(
          `子窗口加載失敗: ${validatedURL} (${errorCode} ${errorDescription})`,
          'WindowManager'
      )
    })

    child.loadURL(url).catch((err) => {
      // 窗口在載入完成前被關閉時，Electron 會 reject 這個 Promise（常見 ERR_FAILED -2 / ERR_ABORTED -3），不算真正錯誤
      if (child.isDestroyed() || err?.code === 'ERR_ABORTED' || err?.errno === -3 || err?.errno === -2) {
        logger.info(`子窗口 loadURL 被中斷（窗口已關閉或載入被取消）: ${url}`, 'WindowManager')
        return
      }
      logger.error(`子窗口 loadURL 拋異常: ${url}`, 'WindowManager', err)
    })

    // 子窗口內的外部鏈接導向系統瀏覽器
    // 同樣走 safeOpenExternal 過濾危險協議
    child.webContents.setWindowOpenHandler(({ url: linkUrl }) => {
      safeOpenExternal(linkUrl)
      return { action: 'deny' }
    })

    logger.info(`子窗口已創建: ${title} → ${url}`, 'WindowManager')
    return child
  }

  /**
   * 建立 AI Agent 獨立窗口。
   *
   * 跟 log-viewer 同模式:
   *  - 不持久化,關閉即銷毀,下次重新建
   *  - 用獨立 preload (`agent.preload.js`),只暴露 agent feature 必要 IPC
   *  - 完全獨立於主窗,互不干擾
   *
   * 由浮球快捷菜單(quickMenu action: 'open-agent')或主窗按鈕觸發。
   */
  createAgentWindow(): BrowserWindow {
    if (this.agentWindow && !this.agentWindow.isDestroyed()) {
      this.agentWindow.show()
      this.agentWindow.focus()
      return this.agentWindow
    }

    this.agentWindow = new BrowserWindow({
      width: 1180,
      height: 800,
      minWidth: 920,
      minHeight: 600,
      icon: appIconPath,
      title: 'AI Agent',
      // 沿用系統標題欄,但藏掉 File/Edit/View/Window/Help 菜單(內部工具不需要)
      frame: true,
      autoHideMenuBar: true,
      show: false,
      backgroundColor: '#f7f7f8',
      webPreferences: {
        preload: join(__dirname, '../preload/agent.preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        devTools: isDev,
      },
    })

    // 徹底移除菜單列(autoHideMenuBar 只藏不移除,Alt 還會喚出)
    this.agentWindow.setMenuBarVisibility(false)
    this.agentWindow.removeMenu()

    if (isDev && process.env['ELECTRON_RENDERER_URL']) {
      // Agent 入口已遷移到 src/entries/agent/(§1.4),build 輸出位置跟著變
      this.agentWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/entries/agent/index.html`)
    } else {
      this.agentWindow.loadFile(join(__dirname, '../renderer/entries/agent/index.html'))
    }

    this.agentWindow.once('ready-to-show', () => {
      this.agentWindow?.show()
      if (isDev) {
        this.agentWindow?.webContents.openDevTools({mode: 'detach'})
      }
      logger.info('Agent 窗口已開啟', 'WindowManager')
    })

    this.agentWindow.on('closed', () => {
      this.agentWindow = null
      logger.info('Agent 窗口已關閉', 'WindowManager')
    })

    // 外部鏈接走系統瀏覽器
    this.agentWindow.webContents.setWindowOpenHandler(({url}) => {
      safeOpenExternal(url)
      return {action: 'deny'}
    })

    return this.agentWindow
  }

  /** 取 Agent 窗口(給 IPC handler 內部判斷可選) */
  getAgentWindow(): BrowserWindow | null {
    return this.agentWindow
  }

  /** 銷毀所有窗口（quitAndInstall / 托盤退出時呼叫） */
  destroyAll(): void {
    this.agentWindow?.destroy()
    this.agentWindow = null
    this.logViewerWindow?.destroy()
    this.logViewerWindow = null
    this.floatingBallWindow?.destroy()
    this.floatingBallWindow = null
    this.mainWindow?.destroy()
    this.mainWindow = null
  }
}
