/**
 * Log bridge:渲染端 logger 寫到主進程 + 開資料夾。
 * 渲染端通常用 src/utils/logger.ts 封裝後呼叫,不直接用此 API。
 */
import type {IpcRenderer} from 'electron'

export function createLogBridge(ipc: IpcRenderer, ch: {LOG_WRITE: string; LOG_OPEN_FOLDER: string}) {
  return {
    write: (entry: {
      level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'
      message: string
      module?: string
      args?: unknown[]
    }) => ipc.send(ch.LOG_WRITE, entry),

    openFolder: () =>
      ipc.invoke(ch.LOG_OPEN_FOLDER) as Promise<{ok: boolean; dir: string}>,
  }
}
