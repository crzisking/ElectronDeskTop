/**
 * 自動更新(electron-updater)相關 IPC channels。
 */
export const UpdateChannels = {
  /** 觸發檢查更新。invoke */
  UPDATE_CHECK: 'update:check',
  /** 主動下載更新(autoDownload=false 時手動觸發) */
  UPDATE_DOWNLOAD: 'update:download',
  /** 立刻退出並安裝(下載完成後) */
  UPDATE_QUIT_AND_INSTALL: 'update:quit-and-install',

  /** PUSH:檢查更新中 */
  PUSH_UPDATE_CHECKING: 'push:update-checking',
  /** PUSH:有新版本可用 */
  PUSH_UPDATE_AVAILABLE: 'push:update-available',
  /** PUSH:無新版本 */
  PUSH_UPDATE_NOT_AVAILABLE: 'push:update-not-available',
  /** PUSH:下載進度 */
  PUSH_UPDATE_PROGRESS: 'push:update-progress',
  /** PUSH:下載完成 */
  PUSH_UPDATE_DOWNLOADED: 'push:update-downloaded',
  /** PUSH:更新流程出錯 */
  PUSH_UPDATE_ERROR: 'push:update-error',
} as const
