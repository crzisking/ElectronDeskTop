/**
 * IPC 頻道常量 - 渲染進程副本
 *
 * 注意：渲染進程不能直接 import electron/shared/ipc-channels.ts
 * （主進程代碼），所以這裡維護一份副本。
 *
 * 維護規則：修改 electron/shared/ipc-channels.ts 後，
 * 同步更新此文件，保持兩者完全一致。
 */
export const IpcChannels = {
  CONFIG_READ: 'config:read',
  CONFIG_WRITE: 'config:write',
  WINDOW_MINIMIZE: 'window:minimize',
  WINDOW_MAXIMIZE: 'window:maximize',
  WINDOW_CLOSE: 'window:close',
  WINDOW_SHOW: 'window:show',
  WINDOW_HIDE: 'window:hide',
  WINDOW_IS_MAXIMIZED: 'window:is-maximized',
  BALL_SHOW: 'floating-ball:show',
  BALL_HIDE: 'floating-ball:hide',
  BALL_START_DRAG: 'floating-ball:start-drag',
  BALL_STOP_DRAG: 'floating-ball:stop-drag',
  BALL_GET_POSITION: 'floating-ball:get-position',
  BALL_MENU_ACTION: 'floating-ball:menu-action',
  AUTH_GET_TOKEN: 'auth:get-token',
  AUTH_SET_TOKEN: 'auth:set-token',
  AUTH_DELETE_TOKEN: 'auth:delete-token',
  PUSH_CONFIG_CHANGED: 'push:config-changed',
  PUSH_TRAY_CLICKED: 'push:tray-clicked',
  PUSH_WINDOW_MAXIMIZED: 'push:window-maximized'
} as const

export type IpcChannel = (typeof IpcChannels)[keyof typeof IpcChannels]
