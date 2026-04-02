/**
 * Auth Token IPC Handler
 *
 * 所有 Auth Token 操作都在主進程中進行，通過 IPC 向渲染進程提供服務。
 *
 * 存儲方案：Electron safeStorage + electron-store
 *  - safeStorage：使用操作系統加密 API 對 Token 進行加密
 *      Windows：DPAPI（Data Protection API）
 *      macOS：Keychain Services
 *      Linux：libsecret / GNOME Keyring（或 Kernel Key Retention Service）
 *  - electron-store：將加密後的 Buffer（Base64 字符串）持久化到磁盤
 *
 * 與 keytar 的區別：
 *  - safeStorage 是 Electron 內置 API，無需額外原生模塊編譯
 *  - keytar 需要針對每個 Electron 版本重新編譯原生模塊，容易出現兼容問題
 *  - safeStorage 加密結果存儲在 electron-store（userData 目錄），而非 OS 鑰匙串
 *    但加密密鑰由 OS 管理，其他進程/用戶無法解密
 *
 * safeStorage 加密流程：
 *  存儲：plainToken → safeStorage.encryptString(token) → Buffer → base64 → electron-store
 *  讀取：electron-store → base64 → Buffer → safeStorage.decryptString() → plainToken
 */

import { ipcMain, safeStorage } from 'electron'
import Store from 'electron-store'
import { IpcChannels } from '../../shared/ipc-channels'
import { logger } from '../utils/logger'

/** electron-store 實例（存儲加密後的 Token） */
const secureStore = new Store<{ encryptedToken?: string }>({
  name: 'secure-credentials',
  // electron-store 本身不加密，加密由 safeStorage 完成
  // 文件存放在 app.getPath('userData')/secure-credentials.json
})

/** electron-store 中存儲加密 Token 的 key 名 */
const TOKEN_KEY = 'encryptedToken'

/**
 * 注冊所有 Auth Token IPC Handler
 */
export function registerAuthHandlers(): void {

  // ─── 讀取 Token ───────────────────────────────────────────────
  ipcMain.handle(IpcChannels.AUTH_GET_TOKEN, () => {
    try {
      // safeStorage 在應用未完全初始化時可能不可用（如 Linux 無 libsecret）
      if (!safeStorage.isEncryptionAvailable()) {
        logger.warn('safeStorage 加密不可用（可能缺少 libsecret），返回 null', 'IPC:auth')
        return null
      }

      const encryptedBase64 = secureStore.get(TOKEN_KEY)
      if (!encryptedBase64) {
        logger.debug('Token 不存在', 'IPC:auth')
        return null
      }

      // Base64 字符串 → Buffer → 解密為明文
      const encryptedBuffer = Buffer.from(encryptedBase64, 'base64')
      const token = safeStorage.decryptString(encryptedBuffer)
      logger.debug('Token 讀取成功', 'IPC:auth')
      return token
    } catch (err) {
      logger.error('讀取 Token 失敗', 'IPC:auth', err)
      return null
    }
  })

  // ─── 存儲 Token ───────────────────────────────────────────────
  ipcMain.handle(IpcChannels.AUTH_SET_TOKEN, (_event, token: string) => {
    try {
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error('safeStorage 加密不可用，無法安全存儲 Token')
      }

      // 明文 Token → 加密 Buffer → Base64 字符串 → 存入 electron-store
      const encryptedBuffer = safeStorage.encryptString(token)
      const encryptedBase64 = encryptedBuffer.toString('base64')
      secureStore.set(TOKEN_KEY, encryptedBase64)
      logger.info('Token 已加密存儲', 'IPC:auth')
    } catch (err) {
      logger.error('存儲 Token 失敗', 'IPC:auth', err)
      throw err
    }
  })

  // ─── 刪除 Token ───────────────────────────────────────────────
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
