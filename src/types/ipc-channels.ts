/**
 * IPC 頻道常量 - 渲染進程入口
 *
 * 通過 @shared alias 直接從 electron/shared/ipc-channels.ts 重新導出，
 * 不再需要手動維護副本，保證主進程和渲染進程使用同一份常量定義。
 */
export {IpcChannels, type IpcChannel} from '@shared/ipc-channels'
