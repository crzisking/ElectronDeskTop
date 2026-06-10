/**
 * Window 控制 bridge:最小化 / 最大化 / 隱藏 / 關閉 / 開子視窗。
 */
import type {IpcRenderer} from 'electron'

export interface WindowChannelMap {
  WINDOW_MINIMIZE: string
  WINDOW_MAXIMIZE: string
  WINDOW_CLOSE: string
  WINDOW_SHOW: string
  WINDOW_HIDE: string
  WINDOW_IS_MAXIMIZED: string
  OPEN_CHILD_WINDOW: string
  WINDOW_OPEN_MEMOS: string
}

export function createWindowBridge(ipc: IpcRenderer, ch: WindowChannelMap) {
  return {
    minimize: () => ipc.send(ch.WINDOW_MINIMIZE),
    maximize: () => ipc.send(ch.WINDOW_MAXIMIZE),
    close: () => ipc.send(ch.WINDOW_CLOSE),
    show: () => ipc.send(ch.WINDOW_SHOW),
    hide: () => ipc.send(ch.WINDOW_HIDE),
    isMaximized: () => ipc.invoke(ch.WINDOW_IS_MAXIMIZED),

    /**
     * 在新 Electron 子窗口打開系統 URL(openMode='electron-window' 用)。
     * @param url   系統訪問 URL
     * @param title 子窗口標題
     */
    openChild: (url: string, title: string) => ipc.invoke(ch.OPEN_CHILD_WINDOW, url, title),

    /** 打開備忘錄獨立窗(docs/20 §5.5) */
    openMemos: () => ipc.invoke(ch.WINDOW_OPEN_MEMOS) as Promise<void>,
  }
}
