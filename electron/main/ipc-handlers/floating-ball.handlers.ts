/**
 * 浮球相關 IPC handlers。
 *
 * 涵蓋:
 *  - BALL_*:拖動 / 顯隱 / 取座標 / 右鍵菜單
 *  - APP_QUIT:整個應用退出(浮球右鍵的「結束應用程式」走這條)
 *
 * 注:OPEN_CHILD_WINDOW 是統一平台卡片用,跟浮球無關,在 window.handlers.ts 註冊。
 */

import {app, ipcMain, Menu} from 'electron'
import {IpcChannels} from '../../shared/ipc-channels'
import {logger} from '../utils/logger'
import {safeOpenExternal} from '../utils/safe-shell'
import type {WindowManager} from '../window-manager'
import type {ConfigManager} from '../config-manager'
import type {FloatingBallManager} from '../floating-ball'

/**
 * 主進程小型 i18n 字典 — 僅用於原生菜單(浮球右鍵菜單、Tray 等)。
 *
 * 為什麼不共用渲染端的 vue-i18n:
 *  - vue-i18n 是 Vue 生態庫,主進程是純 Node.js 環境,引不進來
 *  - 主進程需要的文案非常少,手寫字典維護成本可忽略
 *
 * 鍵約定:與 app-config.json 的 quickMenu[].id 對應。
 * 缺失時自動 fallback 到 item.label(即 JSON 原值,繁中)。
 */
const NATIVE_MENU_I18N: Record<string, Record<string, string>> = {
  'zh-TW': {
    // 留空 → 用 JSON 原值
  },
  en: {
    'menu-show-main':   'Open Main Window',
    'menu-go-platform': 'Unified Platform',
    'menu-go-internal': 'Internal Tools',
    'menu-quit':        'Quit',
  },
}

/** 取菜單項顯示文字:先查 i18n 字典,沒有就 fallback 到 item.label */
function localizeMenuLabel(itemId: string, fallback: string, lang: string): string {
  const dict = NATIVE_MENU_I18N[lang] ?? {}
  return dict[itemId] ?? fallback
}

export function registerFloatingBallHandlers(
  windowManager: WindowManager,
  configManager: ConfigManager,
  floatingBallMgr: FloatingBallManager
): void {

  /** BALL_START_DRAG:浮球 mousedown 觸發拖動 */
  ipcMain.on(IpcChannels.BALL_START_DRAG, () => {
    floatingBallMgr.startDrag()
    logger.debug('浮球開始拖動', 'IPC:ball')
  })

  /** BALL_STOP_DRAG:浮球 mouseup 停止拖動並觸發邊緣吸附 */
  ipcMain.on(IpcChannels.BALL_STOP_DRAG, () => {
    floatingBallMgr.stopDrag()
    logger.debug('浮球停止拖動', 'IPC:ball')
  })

  /** BALL_SHOW:主視窗隱藏時讓浮球顯示 */
  ipcMain.on(IpcChannels.BALL_SHOW, () => {
    windowManager.showFloatingBall()
  })

  /** BALL_HIDE:主視窗顯示時隱藏浮球避免遮擋 */
  ipcMain.on(IpcChannels.BALL_HIDE, () => {
    windowManager.hideFloatingBall()
  })

  /** BALL_GET_POSITION:浮球渲染進程查詢自身座標 { x, y } */
  ipcMain.handle(IpcChannels.BALL_GET_POSITION, () => {
    return windowManager.getFloatingBallPosition()
  })

  /** APP_QUIT:完全退出應用,浮球右鍵菜單「結束應用程式」用 */
  ipcMain.on(IpcChannels.APP_QUIT, () => {
    logger.info('收到退出指令,應用正在退出...', 'IPC:app')
    app.quit()
  })

  /**
   * BALL_SHOW_CONTEXT_MENU:彈出浮球的原生右鍵菜單。
   *
   * 浮球 60×60 太小無法承載 Vue 自繪菜單,改用 OS 級原生菜單突破窗口邊界。
   * 菜單項由 configManager.floatingBall.quickMenu 動態生成,根據 action.type 分派。
   */
  ipcMain.on(IpcChannels.BALL_SHOW_CONTEXT_MENU, () => {
    const config = configManager.getConfig()
    const lang = config.app?.language ?? 'zh-TW'
    const menuItems = config.floatingBall.quickMenu.filter((item) => item.enabled)

    const template = menuItems.map((item) => {
      if (item.separator) return {type: 'separator' as const}

      return {
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
              // (action.url 來自 app-config.json,理論可被外部修改注入)
              safeOpenExternal(action.url)
              break

            case 'open-agent':
              // 開 AI Agent 獨立窗口(跟 log-viewer 同模式)
              windowManager.createAgentWindow()
              break
          }
        },
      }
    })

    const menu = Menu.buildFromTemplate(template)
    const ballWin = windowManager.getFloatingBallWindow()
    menu.popup({window: ballWin ?? undefined})

    logger.debug('浮球原生右鍵菜單已彈出', 'IPC:ball')
  })
}
