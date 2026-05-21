/**
 * Auth 相關 IPC channels(AD 帳號查詢、AD 登入)。
 */
export const AuthChannels = {
  /**
   * AUTH_GET_AD_ACCOUNT:讀取當前 Windows 登入者帳號(用於 AD 自動登入前資訊提示)。
   * invoke。返回:string(帳號)| null。
   */
  AUTH_GET_AD_ACCOUNT: 'auth:get-ad-account',

  /**
   * AUTH_AD_LOGIN:呼叫主進程跑 AD/Kerberos 登入流程,成功返回 JWT。
   * invoke。返回:{ token, user } 或 throw。
   */
  AUTH_AD_LOGIN: 'auth:ad-login',
} as const
