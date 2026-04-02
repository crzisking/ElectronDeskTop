/**
 * 系統托盤管理器
 *
 * 創建並管理系統托盤圖標（通知區圖標）。
 * 托盤是應用退到後台後用戶訪問應用的最後入口。
 *
 * 托盤菜單項與 floatingBall.quickMenu 保持一致（均從配置讀取）。
 *
 * 平台差異：
 *  - macOS：左鍵點擊顯示菜單；使用 Template 圖標自動適應暗色模式
 *  - Windows/Linux：左鍵點擊顯示主窗口；右鍵點擊顯示菜單
 */

import { Tray, Menu, app, nativeImage } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import { logger } from './utils/logger'
import type { WindowManager } from './window-manager'
import type { ConfigManager } from './config-manager'

export class TrayManager {
  private tray: Tray | null = null

  constructor(
    private readonly windowManager: WindowManager,
    private readonly configManager: ConfigManager
  ) {}

  /**
   * 初始化系統托盤
   * 必須在 app.whenReady() 之後調用
   */
  init(): void {
    const iconPath = this.getTrayIconPath()
    let icon = nativeImage.createEmpty()

    if (existsSync(iconPath)) {
      icon = nativeImage.createFromPath(iconPath)
      // macOS 托盤圖標推薦 22×22，Windows 推薦 16×16 或 32×32
      if (process.platform !== 'darwin') {
        icon = icon.resize({ width: 22, height: 22 })
      }
    } else {
      logger.warn(`托盤圖標文件不存在: ${iconPath}，使用空圖標`, 'TrayManager')
    }

    this.tray = new Tray(icon)
    this.tray.setToolTip('企業桌面客戶端')

    // 構建托盤菜單
    this.buildContextMenu()

    // ─── 點擊事件 ──────────────────────────────────────────────
    if (process.platform === 'darwin') {
      // macOS：左鍵和右鍵都顯示菜單（通過 popUpContextMenu）
      // 注意：macOS Tray 的 click 事件在 popUpContextMenu 後不再觸發
    } else {
      // Windows/Linux：左鍵單擊直接顯示主窗口
      this.tray.on('click', () => {
        this.windowManager.showMainWindow()
      })
    }

    logger.info('系統托盤已初始化', 'TrayManager')
  }

  /**
   * 重新構建托盤菜單（配置更新後調用）
   */
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
              // 通知渲染進程導航到對應路由
              setTimeout(() => {
                this.windowManager.sendToMainWindow('floating-ball:menu-action', item.routeName)
              }, 200) // 稍微延遲等待窗口顯示
            }
          }
        ]).items[0]
      )

    const contextMenu = Menu.buildFromTemplate([
      {
        label: '企業桌面客戶端',
        enabled: false // 標題行，不可點擊
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
          // 真正退出：先銷毀窗口再退出
          this.windowManager.destroyAll()
          app.quit()
        }
      }
    ])

    this.tray.setContextMenu(contextMenu)
  }

  /**
   * 獲取托盤圖標路徑
   * macOS 使用 Template 圖標（文件名含 Template），自動適應暗色模式
   */
  private getTrayIconPath(): string {
    const resourcesDir = join(app.getAppPath(), 'resources', 'icons')

    if (process.platform === 'darwin') {
      return join(resourcesDir, 'tray-iconTemplate.png')
    }
    return join(resourcesDir, 'tray-icon.png')
  }

  /** 銷毀托盤（應用退出前調用） */
  destroy(): void {
    this.tray?.destroy()
    this.tray = null
  }
}
