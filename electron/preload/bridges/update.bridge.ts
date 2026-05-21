/**
 * Update bridge:渲染端主動觸發更新檢查 / 下載 / 安裝。
 * 推送事件(進度、可用版本)走 ALLOWED_CHANNELS 白名單 + electronAPI.on。
 */
import type {IpcRenderer} from 'electron'

export interface UpdateChannelMap {
  UPDATE_CHECK: string
  UPDATE_DOWNLOAD: string
  UPDATE_QUIT_AND_INSTALL: string
}

export function createUpdateBridge(ipc: IpcRenderer, ch: UpdateChannelMap) {
  return {
    check: () => ipc.invoke(ch.UPDATE_CHECK),
    download: () => ipc.invoke(ch.UPDATE_DOWNLOAD),
    quitAndInstall: () => ipc.invoke(ch.UPDATE_QUIT_AND_INSTALL),
  }
}
