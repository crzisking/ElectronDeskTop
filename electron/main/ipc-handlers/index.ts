/**
 * IPC Handler 註冊入口。
 * 用於：electron/main/index.ts 在 app.whenReady() 與窗口創建後調用 registerAllHandlers()。
 * 浮球相關邏輯較簡單，直接寫在本檔；其餘委託給子模組註冊。
 */

import {app, ipcMain, Menu} from 'electron'
import {IpcChannels} from '../../shared/ipc-channels'
import {registerWindowHandlers} from './window.handlers'
import {registerConfigHandlers} from './config.handlers'
import {registerUpdateHandlers} from './update.handlers'
import {registerLogHandlers} from './log.handlers'
import {logger} from '../utils/logger'
import {safeOpenExternal} from '../utils/safe-shell'
import type {WindowManager} from '../window-manager'
import type {ConfigManager} from '../config-manager'
import type {FloatingBallManager} from '../floating-ball'
import type {UpdateManager} from '../update-manager'

/**
 * 主進程小型 i18n 字典 — 僅用於原生菜單（浮球右鍵菜單、Tray 等）。
 *
 * 為什麼不共用渲染端的 vue-i18n：
 *  - vue-i18n 是 Vue 生態庫，主進程是純 Node.js 環境，引不進來
 *  - 主進程需要的文案非常少（菜單幾項），手寫字典維護成本可忽略
 *
 * 鍵約定：與 app-config.json 的 quickMenu[].id 對應。
 * 缺失時自動 fallback 到 item.label（即 JSON 原值，繁中）。
 *
 * 原文（quickMenu.id → label）：
 *   menu-show-main   → 打開主窗口
 *   menu-go-platform → 統一平台
 *   menu-go-internal → 內部功能
 *   menu-quit        → 退出應用
 */
const NATIVE_MENU_I18N: Record<string, Record<string, string>> = {
  'zh-TW': {
    // 留空 → 用 JSON 原值
  },
  en: {
    'menu-show-main':   'Open Main Window',
    'menu-go-platform': 'Unified Platform',
    'menu-go-internal': 'Internal Tools',
    'menu-quit':        'Quit'
  }
}

/** 取菜單項顯示文字：先查 i18n 字典，沒有就 fallback 到 item.label */
function localizeMenuLabel(itemId: string, fallback: string, lang: string): string {
  const dict = NATIVE_MENU_I18N[lang] ?? {}
  return dict[itemId] ?? fallback
}

/**
 * 註冊所有 IPC Handler（依賴注入式，使用 main/index.ts 創建好的單例）。
 * 用於：main/index.ts 的 whenReady 回調，需在窗口創建後調用。
 * @param windowManager   窗口管理器
 * @param configManager   配置管理器
 * @param floatingBallMgr 浮球管理器
 * @param updateMgr       自動更新管理器
 */
export function registerAllHandlers(
  windowManager: WindowManager,
  configManager: ConfigManager,
  floatingBallMgr: FloatingBallManager,
  updateMgr: UpdateManager
): void {

  registerWindowHandlers(windowManager)
  registerConfigHandlers(configManager)
  registerUpdateHandlers(updateMgr)
  registerLogHandlers()

  // ─── 浮球 IPC ──────────────────────────────────────────────────────────

  /** BALL_START_DRAG：浮球 mousedown 觸發拖動。 */
  ipcMain.on(IpcChannels.BALL_START_DRAG, () => {
    floatingBallMgr.startDrag()
    logger.debug('浮球開始拖動', 'IPC:ball')
  })

  /** BALL_STOP_DRAG：浮球 mouseup 停止拖動並觸發邊緣吸附。 */
  ipcMain.on(IpcChannels.BALL_STOP_DRAG, () => {
    floatingBallMgr.stopDrag()
    logger.debug('浮球停止拖動', 'IPC:ball')
  })

  /** BALL_SHOW：主窗口隱藏時讓浮球顯示。 */
  ipcMain.on(IpcChannels.BALL_SHOW, () => {
    windowManager.showFloatingBall()
  })

  /** BALL_HIDE：主窗口顯示時隱藏浮球避免遮擋。 */
  ipcMain.on(IpcChannels.BALL_HIDE, () => {
    windowManager.hideFloatingBall()
  })

  /** BALL_GET_POSITION：浮球渲染進程查詢自身座標 { x, y }。 */
  ipcMain.handle(IpcChannels.BALL_GET_POSITION, () => {
    return windowManager.getFloatingBallPosition()
  })

  /**
   * OPEN_CHILD_WINDOW：用 electron-window 模式打開子窗口。
   * 用於：統一平台頁面 openMode='electron-window' 的系統卡片。
   * 安全：從 app-config.json 的系統列表提取域名白名單，只允許打開已配置的系統 URL。
   */
  ipcMain.handle(IpcChannels.OPEN_CHILD_WINDOW, (_event, url: string, title: string) => {
    // 從配置中提取所有系統 URL 的域名作為白名單
    const config = configManager.getConfig()
    const allowedDomains = config.unifiedPlatform.systems
        .map((sys) => {
          try {
            return new URL(sys.url).hostname
          } catch {
            return ''
          }
        })
        .filter(Boolean)

    windowManager.openChildWindow(url, title, allowedDomains)
    logger.info(`打開子窗口: ${title}`, 'IPC:window')
  })

  /**
   * APP_QUIT：完全退出應用。
   * 用於：浮球右鍵菜單「結束應用程式」。
   */
  ipcMain.on(IpcChannels.APP_QUIT, () => {
    logger.info('收到退出指令，應用正在退出...', 'IPC:app')
    app.quit()
  })

  /**
   * BALL_SHOW_CONTEXT_MENU：彈出浮球的原生右鍵菜單。
   * 用於：浮球 60×60 太小無法承載 Vue 自繪菜單，改用 OS 級原生菜單突破窗口邊界。
   * 菜單項由 configManager.floatingBall.quickMenu 動態生成，根據 action.type 分派。
   */
  ipcMain.on(IpcChannels.BALL_SHOW_CONTEXT_MENU, (event) => {
    const config = configManager.getConfig()
    const lang = config.app?.language ?? 'zh-TW'
    const menuItems = config.floatingBall.quickMenu.filter((item) => item.enabled)

    const template = menuItems.map((item) => {
      if (item.separator) return { type: 'separator' as const }

      return {
        // 走主進程 i18n helper：英文環境顯示翻譯，繁中保留 JSON 原文
        label: localizeMenuLabel(item.id, item.label, lang),
        click: () => {
          const action = item.action
          switch (action.type) {
            case 'show-main-window':
              windowManager.showMainWindow()
              break

            case 'navigate': {
              windowManager.showMainWindow()
              const mainWin = windowManager.getMainWindow()
              if (mainWin && !mainWin.isDestroyed()) {
                  mainWin.webContents.send(IpcChannels.PUSH_BALL_NAVIGATE, action.routeName)
              }
              break
            }

            case 'quit-app':
              app.quit()
              break

            case 'open-url':
              // 走 safeOpenExternal 過濾 javascript: / file:// 等危險協議
              // （action.url 來自 app-config.json，理論可被外部修改注入）
              safeOpenExternal(action.url)
              break
          }
        }
      }
    })

    const menu = Menu.buildFromTemplate(template)
    const ballWin = windowManager.getFloatingBallWindow()
    menu.popup({ window: ballWin ?? undefined })

    logger.debug('浮球原生右鍵菜單已彈出', 'IPC:ball')
  })

  logger.info('所有 IPC Handlers 注冊完成', 'IPC')
}
