/**
 * 日誌查看器 bridge(密碼解鎖 + 開子視窗)。
 * 查詢 API 在獨立 log-viewer.preload.ts 內暴露,主窗口不需要。
 */
import type {IpcRenderer} from 'electron'

export function createLogViewerBridge(
  ipc: IpcRenderer,
  ch: {LOG_VIEWER_UNLOCK: string; WINDOW_OPEN_LOG_VIEWER: string}
) {
  return {
    /** 驗證密碼,正確時 session 解鎖,後續可開窗 / 查詢 */
    unlock: (password: string) =>
      ipc.invoke(ch.LOG_VIEWER_UNLOCK, password) as Promise<boolean>,
    /** 開啟日誌查看器子視窗(必須先 unlock 成功) */
    openWindow: () => ipc.send(ch.WINDOW_OPEN_LOG_VIEWER),
  }
}
