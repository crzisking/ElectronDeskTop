/**
 * 浮球控制 bridge。
 * 注:浮球右鍵菜單的 navigate 由主進程統一處理,經 PUSH_BALL_NAVIGATE 推到主窗口,
 * 不需在這命名空間單獨暴露 onMenuAction 接口。
 */
import type {IpcRenderer} from 'electron'

export interface FloatingBallChannelMap {
  BALL_SHOW: string
  BALL_HIDE: string
  BALL_START_DRAG: string
  BALL_STOP_DRAG: string
}

export function createFloatingBallBridge(ipc: IpcRenderer, ch: FloatingBallChannelMap) {
  return {
    show: () => ipc.send(ch.BALL_SHOW),
    hide: () => ipc.send(ch.BALL_HIDE),
    startDrag: () => ipc.send(ch.BALL_START_DRAG),
    stopDrag: () => ipc.send(ch.BALL_STOP_DRAG),
  }
}
