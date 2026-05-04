/**
 * 集中管理主窗口 + 浮球窗口的狀態機。
 * 用於：electron/main/index.ts 啟動時建構，IPC handler / TrayManager / UpdateManager 都會引用。
 * 狀態：主窗口顯示 ←→ 主窗口隱藏 + 浮球顯示。
 */

import {app, BrowserWindow, screen} from 'electron'
import {join} from 'path'
import {logger} from './utils/logger'
import {safeOpenExternal} from './utils/safe-shell'

const isDev = !app.isPackaged

/** 應用圖標（Windows 任務欄、窗口標題欄使用） */
const appIconPath = join(__dirname, '../../resources/icons/icon.ico')

export class WindowManager {
  private mainWindow: BrowserWindow | null = null

  /** 浮球窗口應用生命週期內持久存在，僅 show/hide 切換 */
  private floatingBallWindow: BrowserWindow | null = null

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
      backgroundColor: '#f5f7fa',
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
   * 設置浮球位置（會 clamp 到屏幕工作區內）。
   * @param x 目標 X 座標
   * @param y 目標 Y 座標
   * @param ballSize 浮球大小（用於計算邊界，默認 80 與窗口/CSS 一致）
   */
  setFloatingBallPosition(x: number, y: number, ballSize = 80): void {
    if (!this.floatingBallWindow) return

    const { width, height } = screen.getPrimaryDisplay().workAreaSize

    const clampedX = Math.max(0, Math.min(x, width - ballSize))
    const clampedY = Math.max(0, Math.min(y, height - ballSize))

    this.floatingBallWindow.setPosition(clampedX, clampedY)
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
        sandbox: true,
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

    child.loadURL(url)

    // 子窗口內的外部鏈接導向系統瀏覽器
    // 同樣走 safeOpenExternal 過濾危險協議
    child.webContents.setWindowOpenHandler(({ url: linkUrl }) => {
      safeOpenExternal(linkUrl)
      return { action: 'deny' }
    })

    logger.info(`子窗口已創建: ${title} → ${url}`, 'WindowManager')
    return child
  }

  /** 銷毀所有窗口（quitAndInstall / 托盤退出時呼叫） */
  destroyAll(): void {
    this.floatingBallWindow?.destroy()
    this.floatingBallWindow = null
    this.mainWindow?.destroy()
    this.mainWindow = null
  }
}
