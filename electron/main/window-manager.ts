/**
 * 窗口管理器
 *
 * 集中管理所有 BrowserWindow 實例，是整個應用的窗口狀態機核心。
 *
 * 管理的窗口：
 *  1. 主窗口（mainWindow）：企業客戶端主界面，自定義標題欄（frameless）
 *  2. 浮球窗口（floatingBallWindow）：透明、置頂、可拖動的小圓球
 *
 * 窗口狀態機：
 *  主窗口顯示 ←→ 主窗口隱藏 + 浮球顯示
 *
 * 安全配置原則：
 *  - contextIsolation: true  （渲染進程無法訪問 Node.js）
 *  - nodeIntegration: false  （渲染進程無法 require）
 *  - sandbox: true           （Chromium 沙盒隔離）
 */

import { app, BrowserWindow, screen, shell } from 'electron'
import { join } from 'path'
import { logger } from './utils/logger'

/** 是否為開發模式（electron-vite 在開發時設置 ELECTRON_RENDERER_URL） */
const isDev = !app.isPackaged

export class WindowManager {
  /** 主窗口實例（可能為 null，創建前或銷毀後） */
  private mainWindow: BrowserWindow | null = null

  /** 浮球窗口實例（應用生命週期內持久存在，僅 show/hide 切換） */
  private floatingBallWindow: BrowserWindow | null = null

  /**
   * 創建並初始化主窗口
   * - 使用 show: false 防止加載時白閃
   * - 監聽 ready-to-show 後再顯示
   * - 攔截 close 事件，改為隱藏+顯示浮球
   */
  createMainWindow(): BrowserWindow {
    this.mainWindow = new BrowserWindow({
      width: 1200,
      height: 800,
      minWidth: 960,
      minHeight: 620,
      // 自定義標題欄（在 Vue 中渲染，包含拖動區域和窗口控制按鈕）
      frame: false,
      // 先隱藏，ready-to-show 後才顯示，防止加載期間白閃
      show: false,
      // 背景色與應用主色調一致，減少閃爍
      backgroundColor: '#f5f7fa',
      webPreferences: {
        // 預加載腳本路徑（electron-vite 編譯輸出到 out/preload/index.js）
        preload: join(__dirname, '../preload/index.js'),
        // 安全三件套（生產必須）
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false, // false 允許 preload 使用 require
        // 開發工具在開發模式下自動打開
        devTools: isDev
      }
    })

    // ─── 加載頁面 ──────────────────────────────────────────────
    if (isDev && process.env['ELECTRON_RENDERER_URL']) {
      // 開發環境：加載 Vite 開發服務器
      this.mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
    } else {
      // 生產環境：加載打包後的 HTML 文件
      this.mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
    }

    // ─── 首次顯示 ──────────────────────────────────────────────
    // ready-to-show 在首次渲染完成後觸發，此時顯示窗口不會白閃
    this.mainWindow.once('ready-to-show', () => {
      if (!this.mainWindow) return
      this.mainWindow.show()
      // 開發環境默認打開 DevTools
      if (isDev) {
        this.mainWindow.webContents.openDevTools({ mode: 'detach' })
      }
      logger.info('主窗口已顯示', 'WindowManager')
    })

    // ─── 攔截關閉事件 ─────────────────────────────────────────
    // 用戶點擊標題欄 × 按鈕時，不退出應用，改為隱藏主窗口並顯示浮球
    this.mainWindow.on('close', (event) => {
      event.preventDefault() // 阻止默認關閉行為
      this.hideMainWindow()
      logger.debug('主窗口 close 事件被攔截，切換為浮球模式', 'WindowManager')
    })

    // ─── 最大化狀態變化 ─────────────────────────────────────
    // 通知渲染進程更新標題欄最大化按鈕狀態
    this.mainWindow.on('maximize', () => {
      this.mainWindow?.webContents.send('push:window-maximized', true)
    })
    this.mainWindow.on('unmaximize', () => {
      this.mainWindow?.webContents.send('push:window-maximized', false)
    })

    // ─── 在新瀏覽器窗口打開外部鏈接 ──────────────────────────
    // 防止在 Electron 窗口內打開外部 URL
    this.mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url)
      return { action: 'deny' } // 阻止創建新 BrowserWindow
    })

    logger.info('主窗口已創建', 'WindowManager')
    return this.mainWindow
  }

  /**
   * 創建浮球窗口
   * - 透明、置頂、無邊框、60×60 圓形
   * - 默認隱藏，主窗口隱藏後才顯示
   * - 有獨立的預加載腳本
   */
  createFloatingBallWindow(): BrowserWindow {
    this.floatingBallWindow = new BrowserWindow({
      width: 64,
      height: 64,
      // 無邊框（標題欄、邊框全無）
      frame: false,
      // 透明背景，配合 CSS border-radius 呈現圓形
      transparent: true,
      // 始終置頂，跨所有應用（包括全屏應用）顯示在最上層
      alwaysOnTop: true,
      // 不在任務欄顯示
      skipTaskbar: true,
      // 固定大小，不允許用戶調整
      resizable: false,
      // 不顯示窗口陰影（透明窗口不需要）
      hasShadow: false,
      // 默認隱藏，主窗口隱藏後顯示
      show: false,
      // 不顯示在 macOS 的 Expose/Mission Control 等視圖中
      focusable: false,
      webPreferences: {
        preload: join(__dirname, '../preload/floatingBall.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false
      }
    })

    // Windows 上設置更高的置頂級別，防止被全屏窗口遮擋
    if (process.platform === 'win32') {
      this.floatingBallWindow.setAlwaysOnTop(true, 'screen-saver')
    } else if (process.platform === 'darwin') {
      this.floatingBallWindow.setAlwaysOnTop(true, 'floating')
    }

    // ─── 加載浮球頁面 ─────────────────────────────────────────
    if (isDev && process.env['ELECTRON_RENDERER_URL']) {
      // 開發環境：加載浮球頁面（注意路徑後綴）
      // electron-vite dev server 根目錄為 src/，所以路徑不含 src 前綴
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

  // ─── 公共方法 ─────────────────────────────────────────────────

  /** 顯示主窗口，隱藏浮球 */
  showMainWindow(): void {
    if (!this.mainWindow) return
    this.mainWindow.show()
    this.mainWindow.focus()
    this.floatingBallWindow?.hide()
    logger.debug('顯示主窗口，隱藏浮球', 'WindowManager')
  }

  /** 隱藏主窗口，顯示浮球 */
  hideMainWindow(): void {
    if (!this.mainWindow) return
    this.mainWindow.hide()
    this.showFloatingBall()
    logger.debug('隱藏主窗口，顯示浮球', 'WindowManager')
  }

  /** 顯示浮球窗口 */
  showFloatingBall(): void {
    if (!this.floatingBallWindow) return
    this.floatingBallWindow.show()
  }

  /** 隱藏浮球窗口 */
  hideFloatingBall(): void {
    this.floatingBallWindow?.hide()
  }

  /** 獲取主窗口實例（外部模塊使用） */
  getMainWindow(): BrowserWindow | null {
    return this.mainWindow
  }

  /** 獲取浮球窗口實例（供 FloatingBallManager 使用） */
  getFloatingBallWindow(): BrowserWindow | null {
    return this.floatingBallWindow
  }

  /** 向主窗口渲染進程發送消息 */
  sendToMainWindow(channel: string, ...args: unknown[]): void {
    this.mainWindow?.webContents.send(channel, ...args)
  }

  /**
   * 獲取浮球當前位置
   * @returns { x, y } 屏幕座標
   */
  getFloatingBallPosition(): { x: number; y: number } {
    if (!this.floatingBallWindow) return { x: 100, y: 300 }
    const [x, y] = this.floatingBallWindow.getPosition()
    return { x, y }
  }

  /**
   * 設置浮球位置（並進行邊界限制）
   * @param x 目標 X 座標
   * @param y 目標 Y 座標
   * @param ballSize 浮球大小（用於計算最大坐標邊界）
   */
  setFloatingBallPosition(x: number, y: number, ballSize = 60): void {
    if (!this.floatingBallWindow) return

    // 獲取主顯示器的工作區（排除任務欄）
    const { width, height } = screen.getPrimaryDisplay().workAreaSize

    // 邊界限制：確保浮球不超出屏幕
    const clampedX = Math.max(0, Math.min(x, width - ballSize))
    const clampedY = Math.max(0, Math.min(y, height - ballSize))

    this.floatingBallWindow.setPosition(clampedX, clampedY)
  }

  /**
   * 在新的 Electron 窗口中打開指定 URL
   *
   * 用於 openMode: 'electron-window' 的系統：
   *  - 不受 iframe X-Frame-Options 限制（直接加載 URL）
   *  - 保持在應用窗口內（不離開應用到外部瀏覽器）
   *  - 每次打開創建一個新窗口，關閉時自動銷毀
   *
   * @param url   要加載的系統 URL
   * @param title 窗口標題（顯示在任務欄）
   */
  openChildWindow(url: string, title: string): BrowserWindow {
    const child = new BrowserWindow({
      width: 1200,
      height: 800,
      title,
      // 使用系統原生標題欄（子窗口不需要自定義標題欄）
      frame: true,
      webPreferences: {
        // 安全配置：子窗口不需要 Node.js 能力
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    })

    // 加載目標 URL
    child.loadURL(url)

    // 攔截新窗口打開請求，改為在系統默認瀏覽器打開
    child.webContents.setWindowOpenHandler(({ url: linkUrl }) => {
      shell.openExternal(linkUrl)
      return { action: 'deny' }
    })

    logger.info(`子窗口已創建: ${title} → ${url}`, 'WindowManager')
    return child
  }

  /** 銷毀所有窗口（應用退出前調用） */
  destroyAll(): void {
    this.floatingBallWindow?.destroy()
    this.floatingBallWindow = null
    this.mainWindow?.destroy()
    this.mainWindow = null
  }
}
