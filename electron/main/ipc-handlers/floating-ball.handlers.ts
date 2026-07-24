/**
 * 浮球相關 IPC handlers。
 *
 * 涵蓋:
 *  - BALL_START_DRAG / BALL_STOP_DRAG:拖動
 *  - BALL_SHOW_CONTEXT_MENU:右鍵原生菜單(內含 quit-app 直接 app.quit())
 *
 * 注:OPEN_CHILD_WINDOW 是統一平台卡片用,跟浮球無關,在 window.handlers.ts 註冊。
 */

import {app, ipcMain, Menu} from 'electron'
import {IpcChannels} from '../../shared/ipc-channels'
import {logger} from '../utils/logger'
import {safeOpenExternal} from '../utils/safe-shell'
import {readPetFrames} from '../pet-frames'
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

    /** BALL_GET_PET_FRAMES:回桌面寵物所有動作的 sprite 幀(base64);renderer 進寵物模式時取一次 */
    ipcMain.handle(IpcChannels.BALL_GET_PET_FRAMES, () => readPetFrames())

    /** 切換造型(小球 ⇄ 寵物):存 config(永久)+ 調視窗尺寸 + 推 renderer 換裝 */
    function toggleAppearance(): void {
        const cur = configManager.getConfig().floatingBall
        const next = cur.mode === 'pet' ? 'ball' : 'pet'
        // 永久保存(mode 非 dev-owned,重啟後保留);失敗不阻塞 UI 切換
        void configManager.writeConfig({floatingBall: {...cur, mode: next}})
            .catch((err) => logger.warn('保存造型模式失敗', 'IPC:ball', err))
        // 視窗尺寸跟著換,並讓拖曳 clamp 對齊新尺寸
        const size = windowManager.applyFloatingBallMode(next)
        floatingBallMgr.setBallSize(size)
        // 推給浮球 renderer 即時換裝
        const ballWin = windowManager.getFloatingBallWindow()
        if (ballWin && !ballWin.isDestroyed()) {
            ballWin.webContents.send(IpcChannels.PUSH_BALL_MODE_CHANGED, next)
        }
        logger.info(`造型切換 → ${next}`, 'IPC:ball')
    }

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

              case 'toggle-appearance':
                  toggleAppearance()
                  break

            case 'open-url':
              // 走 safeOpenExternal 過濾 javascript: / file:// 等危險協議
              // (action.url 來自 app-config.json,理論可被外部修改注入)
              safeOpenExternal(action.url)
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
