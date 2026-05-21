/**
 * Auth bridge:取本機 AD 帳號 + AD 登入。
 */
import type {IpcRenderer} from 'electron'

export function createAuthBridge(
  ipc: IpcRenderer,
  ch: {AUTH_GET_AD_ACCOUNT: string; AUTH_AD_LOGIN: string}
) {
  return {
    /** 取本機 Windows 帳號名(域機環境下即為 AD 帳號);非 Windows 平台返回空字串 */
    getAdAccount: () => ipc.invoke(ch.AUTH_GET_AD_ACCOUNT) as Promise<string>,
    /** AD 登入,失敗 reject;成功返回 JWT 字串 */
    adLogin: (account: string) => ipc.invoke(ch.AUTH_AD_LOGIN, account) as Promise<string>,
  }
}
