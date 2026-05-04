/**
 * 系統托盤圖標 + 右鍵菜單管理。
 * 用於：electron/main/index.ts 啟動末段 init()，是應用退到後台後的最後入口。
 * 平台差異：macOS 用 Template 圖標自適應暗色模式；Windows/Linux 左鍵直接顯示主窗口。
 */

import {app, Menu, nativeImage, Tray} from 'electron'
import {join} from 'path'
import {existsSync} from 'fs'
import {logger} from './utils/logger'
import {IpcChannels} from '../shared/ipc-channels'
import type {WindowManager} from './window-manager'
import type {ConfigManager} from './config-manager'

export class TrayManager {
  private tray: Tray | null = null

  /**
   * 退出清理回調，由 index.ts 注入 gracefulShutdown。
   * 避免在 tray-manager 中重複退出邏輯，統一由 gracefulShutdown 管理。
   */
  private onQuitCallback: (() => void) | null = null

  constructor(
    private readonly windowManager: WindowManager,
    private readonly configManager: ConfigManager
  ) {}

  /**
   * 注入退出清理回調。
   * 由 index.ts 在建構後呼叫，注入 gracefulShutdown 函數。
   * @param callback 退出前清理函數（gracefulShutdown）
   */
  setQuitCallback(callback: () => void): void {
    this.onQuitCallback = callback
  }

  /** 必須在 app.whenReady() 之後呼叫 */
  init(): void {
    const iconPath = this.getTrayIconPath()
    let icon = nativeImage.createEmpty()

    if (existsSync(iconPath)) {
      icon = nativeImage.createFromPath(iconPath)
      // 非 macOS 縮到 22×22（Windows 16/32、Linux 22 都能接受）
      if (process.platform !== 'darwin') {
        icon = icon.resize({ width: 22, height: 22 })
      }
    } else {
      logger.warn(`托盤圖標文件不存在: ${iconPath}，使用空圖標`, 'TrayManager')
    }

    this.tray = new Tray(icon)
    this.tray.setToolTip('ichiaDesktop')

    this.buildContextMenu()

    if (process.platform === 'darwin') {
      // macOS 左右鍵都走 popUpContextMenu，click 在 popUp 後不會再觸發
    } else {
      this.tray.on('click', () => {
        this.windowManager.showMainWindow()
      })
    }

    logger.info('系統托盤已初始化', 'TrayManager')
  }

  /** 重新構建托盤菜單（配置更新後呼叫） */
  buildContextMenu(): void {
    if (!this.tray) return

    const config = this.configManager.getConfig()

    // 從 sidebar.items 動態生成導航菜單項
    const navItems = config.sidebar.items
      .filter((item) => item.enabled)
      .map((item) =>
        Menu.buildFromTemplate([
          {
            label: item.label,
            click: () => {
              this.windowManager.showMainWindow()
              // 延遲 200ms 等窗口顯示後再導航
              setTimeout(() => {
                  // 與浮球右鍵菜單共用頻道，主窗口 App.vue 監聽 PUSH_BALL_NAVIGATE
                  this.windowManager.sendToMainWindow(IpcChannels.PUSH_BALL_NAVIGATE, item.routeName)
              }, 200)
            }
          }
        ]).items[0]
      )

    const contextMenu = Menu.buildFromTemplate([
      {
        label: '企業桌面客戶端',
        enabled: false // 標題行
      },
      { type: 'separator' },
      {
        label: '開啟主視窗',
        click: () => this.windowManager.showMainWindow()
      },
      { type: 'separator' },
      ...navItems,
      { type: 'separator' },
      {
        label: '結束應用程式',
        click: () => {
          // 呼叫統一的退出清理函數，避免重複退出邏輯
          if (this.onQuitCallback) {
            this.onQuitCallback()
          } else {
            // 回退：如果未注入回調，直接執行基本退出流程
            this.windowManager.setQuitting(true)
            this.windowManager.destroyAll()
          }
          app.quit()
        }
      }
    ])

    this.tray.setContextMenu(contextMenu)
  }

  /**
   * 取托盤圖標路徑。
   * macOS 用 Template 圖標（檔名含 Template 後綴）自適應暗色模式。
   */
  private getTrayIconPath(): string {
    const resourcesDir = join(app.getAppPath(), 'resources', 'icons')

    if (process.platform === 'darwin') {
      return join(resourcesDir, 'tray-iconTemplate.png')
    }
    return join(resourcesDir, 'tray-icon.png')
  }

  /** 銷毀托盤（before-quit / quitAndInstall 時呼叫） */
  destroy(): void {
    this.tray?.destroy()
    this.tray = null
  }
}
