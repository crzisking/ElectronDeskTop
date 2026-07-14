/**
 * 靈感速記全域快捷鍵管理(docs/21 §3.2)。
 *
 * app ready 後註冊;配置改熱鍵後 reregister。觸發時:
 *   (可選)先抓一次前景視窗標題當上下文 → 再開速記小窗。
 * 標題必須在小窗搶到前景**之前**抓,否則抓到的是小窗自己;故 capture 完再 open。
 * 抓標題預設關閉(見 config),開啟時才 await,避免拖慢彈窗。
 */

import {globalShortcut} from 'electron'
import {logger} from '../utils/logger'
import type {WindowManager} from '../windows/window-manager'
import type {IdeaConfigStore} from './config-store'
import {getForegroundWindowTitle} from './active-window'

const TAG = 'idea.hotkey'

export class IdeaHotkeyManager {
    private registered = ''
    /** 快捷鍵按下瞬間抓到的前景視窗標題,供小窗 IDEA_GET_CONTEXT 取一次 */
    private pendingActiveWindow = ''

    constructor(
        private readonly configStore: IdeaConfigStore,
        private readonly windowManager: WindowManager,
    ) {
    }

    /** 依當前配置(重新)註冊熱鍵;回是否成功 */
    register(): boolean {
        this.unregister()
        const {hotkey} = this.configStore.read()
        try {
            const ok = globalShortcut.register(hotkey, () => void this.trigger())
            if (ok) {
                this.registered = hotkey
                logger.info(`靈感速記熱鍵已註冊:${hotkey}`, TAG)
            } else {
                logger.warn(`熱鍵註冊失敗(可能被佔用):${hotkey}`, TAG)
            }
            return ok
        } catch (err) {
            logger.warn(`熱鍵註冊異常:${(err as Error).message}`, TAG)
            return false
        }
    }

    unregister(): void {
        if (this.registered) {
            try {
                globalShortcut.unregister(this.registered)
            } catch { /* ignore */
            }
            this.registered = ''
        }
    }

    /** 取並清掉本次待帶的上下文(小窗開啟後取一次) */
    takePendingContext(): { activeWindow: string } {
        const activeWindow = this.pendingActiveWindow
        this.pendingActiveWindow = ''
        return {activeWindow}
    }

    private async trigger(): Promise<void> {
        const {captureActiveWindow} = this.configStore.read()
        // 先抓標題(要在小窗搶焦前),再開窗
        this.pendingActiveWindow = captureActiveWindow ? await getForegroundWindowTitle() : ''
        this.windowManager.createIdeaCaptureWindow()
    }
}
