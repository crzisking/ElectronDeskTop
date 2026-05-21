/**
 * Config bridge:渲染端讀寫 app-config.json。
 * Factory 模式 —— index.ts 注入 ipcRenderer + channels,避免 bridge 檔本身 import electron 模組
 * (預加載腳本 rollup 若拆 chunk,Electron 沙盒不一定能解析相對路徑)。
 */
import type {IpcRenderer} from 'electron'

export function createConfigBridge(ipc: IpcRenderer, ch: {CONFIG_READ: string; CONFIG_WRITE: string}) {
  return {
    /** @returns Promise<AppConfig> */
    read: () => ipc.invoke(ch.CONFIG_READ),
    /** @param config Partial<AppConfig> */
    write: (config: unknown) => ipc.invoke(ch.CONFIG_WRITE, config),
  }
}
