/**
 * Auth Token IPC Handler（讀/寫/刪），全部在主進程進行。
 * 用於：登錄/登出流程儲存 access token。
 * 加密：safeStorage（OS 級：Win DPAPI / macOS Keychain / Linux libsecret）
 *       + electron-store 將密文 base64 落地到 userData/secure-credentials.json。
 *       相較 keytar 免原生模塊編譯，跨 Electron 版本更穩定。
 */

import { ipcMain, safeStorage } from 'electron'
import Store from 'electron-store'
import { IpcChannels } from '../../shared/ipc-channels'
import { logger } from '../utils/logger'

/** electron-store 實例（存儲加密後的 Token Base64） */
const secureStore = new Store<{ encryptedToken?: string }>({
  name: 'secure-credentials',
})

/** electron-store 中存儲加密 Token 的 key 名 */
const TOKEN_KEY = 'encryptedToken'

/** 註冊所有 Auth Token IPC Handler */
export function registerAuthHandlers(): void {

  ipcMain.handle(IpcChannels.AUTH_GET_TOKEN, () => {
    try {
      // safeStorage 在某些 Linux 環境（缺 libsecret）不可用
      if (!safeStorage.isEncryptionAvailable()) {
        logger.warn('safeStorage 加密不可用（可能缺少 libsecret），返回 null', 'IPC:auth')
        return null
      }

      const encryptedBase64 = secureStore.get(TOKEN_KEY)
      if (!encryptedBase64) {
        logger.debug('Token 不存在', 'IPC:auth')
        return null
      }

      const encryptedBuffer = Buffer.from(encryptedBase64, 'base64')
      const token = safeStorage.decryptString(encryptedBuffer)
      logger.debug('Token 讀取成功', 'IPC:auth')
      return token
    } catch (err) {
      logger.error('讀取 Token 失敗', 'IPC:auth', err)
      return null
    }
  })

  ipcMain.handle(IpcChannels.AUTH_SET_TOKEN, (_event, token: string) => {
    try {
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error('safeStorage 加密不可用，無法安全存儲 Token')
      }

      const encryptedBuffer = safeStorage.encryptString(token)
      const encryptedBase64 = encryptedBuffer.toString('base64')
      secureStore.set(TOKEN_KEY, encryptedBase64)
      logger.info('Token 已加密存儲', 'IPC:auth')
    } catch (err) {
      logger.error('存儲 Token 失敗', 'IPC:auth', err)
      throw err
    }
  })

  ipcMain.handle(IpcChannels.AUTH_DELETE_TOKEN, () => {
    try {
      secureStore.delete(TOKEN_KEY)
      logger.info('Token 已刪除', 'IPC:auth')
    } catch (err) {
      logger.error('刪除 Token 失敗', 'IPC:auth', err)
      throw err
    }
  })

  logger.info('Auth IPC Handlers 已注冊（safeStorage 模式）', 'IPC:auth')
}
