/**
 * 認證相關 IPC handler。
 *
 *  - AUTH_GET_AD_ACCOUNT:取得本機 Windows 登入帳號名稱(os.userInfo().username)
 *  - AUTH_AD_LOGIN     :以該帳號名向後端換 JWT(在主進程發 HTTP 避開 CORS)
 *
 * 為什麼放主進程:
 *  - os 模組:渲染進程沙箱無法直接存取
 *  - HTTP 換 token:渲染進程跨域會觸發 CORS preflight,後端未配合則被擋;
 *    主進程是 Node 環境,沒有 CORS,可直接打。同時把 endpoint URL 與固定
 *    Authorization 常數收斂到主進程,不暴露給網頁端。
 */

import {ipcMain, net} from 'electron'
import os from 'os'
import {IpcChannels} from '../../shared/ipc-channels'
import {logger} from '../utils/logger'
import {authContext} from '../services/auth-context'

/**
 * AD 換 token 端點 —— 跨環境唯一。
 * 跟一般 login (VITE_AUTH_BASE_URL) 不同,此服務正式/測試都打同一台,不放 .env。
 */
const AD_TOKEN_ENDPOINT = 'http://api.ichia.com/oauth/api/portal/OAuth/ad/get/token'

/**
 * AD 接口固定的 Authorization,用於上游校驗呼叫端。
 * 跟使用者 JWT 是兩回事(這是給「客戶端身分」用的常數)。
 */
const AD_ENDPOINT_AUTH = '6ebe608a-c182-410f-990b-4fe3ccda54f9'

/** AD 接口請求超時(毫秒),避免網路不通時卡住啟動流程 */
const AD_REQUEST_TIMEOUT_MS = 10000

/**
 * 取本機 Windows 登入帳號(如 "jacky.chen")。
 * 在域機環境下,此值即為 AD sAMAccountName,後端 ad-token 接口期望的就是這個。
 * 非 Windows 平台返回空字串,由渲染端判定後降級到手動登入。
 */
function getAdAccount(): string {
  if (process.platform !== 'win32') return ''
  try {
    const username = os.userInfo().username ?? ''
    return username.trim()
  } catch (err) {
    logger.warn('讀取 Windows 帳號失敗,降級為空字串', 'Auth', err as Error)
    return ''
  }
}

/**
 * 主進程版的 AD 換 token。
 *
 * 用 Electron 自帶的 net 模組(底層走 Chromium network stack):
 *  - 比 Node http 模組更貼近瀏覽器行為(如 follow redirect / 系統 proxy)
 *  - 不需要額外依賴(axios 主進程沒裝)
 *  - 不受 CORS 限制(這是主進程,本來就沒有 CORS)
 *
 * @returns token 字串;失敗或空回傳一律返回空字串,讓渲染端統一當失敗處理
 */
function adLogin(account: string): Promise<string> {
  return new Promise((resolve) => {
    if (!account) return resolve('')

    const url = `${AD_TOKEN_ENDPOINT}?ad=${encodeURIComponent(account)}`
    const request = net.request({method: 'GET', url})
    request.setHeader('Authorization', AD_ENDPOINT_AUTH)

    // 自行管理 timeout,確保啟動流程不會被慢網路拖死
    const timer = setTimeout(() => {
      try {
        request.abort()
      } catch {
        /* noop */
      }
      logger.warn(`AD 換 token 超時 (${AD_REQUEST_TIMEOUT_MS}ms),帳號=${account}`, 'Auth')
      resolve('')
    }, AD_REQUEST_TIMEOUT_MS)

    request.on('response', (response) => {
      let body = ''
      response.on('data', (chunk) => {
        body += chunk.toString('utf-8')
      })
      response.on('end', () => {
        clearTimeout(timer)
        if (response.statusCode < 200 || response.statusCode >= 300) {
          logger.warn(
              `AD 換 token HTTP ${response.statusCode},帳號=${account}`,
              'Auth'
          )
          return resolve('')
        }
        // 後端回傳可能直接是 JWT 字串,也可能被引號包住,統一去頭尾空白與引號
        const token = body.trim().replace(/^"|"$/g, '')
        resolve(token)
      })
      response.on('error', (err: Error) => {
        clearTimeout(timer)
        logger.warn(`AD 換 token response 錯誤,帳號=${account}`, 'Auth', err)
        resolve('')
      })
    })

    request.on('error', (err: Error) => {
      clearTimeout(timer)
      logger.warn(`AD 換 token request 錯誤,帳號=${account}`, 'Auth', err)
      resolve('')
    })

    request.end()
  })
}

export function registerAuthHandlers(): void {
  ipcMain.handle(IpcChannels.AUTH_GET_AD_ACCOUNT, () => {
    const account = getAdAccount()
    logger.info(`本機 AD 帳號讀取結果: ${account || '(空)'}`, 'Auth')
    return account
  })

  ipcMain.handle(IpcChannels.AUTH_AD_LOGIN, async (_event, account: string) => {
    if (!account || typeof account !== 'string') return ''
    const token = await adLogin(account)
    logger.info(
        `AD 換 token 完成,帳號=${account},長度=${token.length}`,
        'Auth'
    )
    return token
  })

  /**
   * 主窗 renderer 登入完成 / 登出時推進來,主進程持作子視窗的身分來源。
   * payload: {userId, token?} 或 {userId: ''} 表示清空。
   */
  ipcMain.handle(IpcChannels.AUTH_SET_CONTEXT, (_e, payload: { userId?: string; token?: string; baseUrl?: string }) => {
    const userId = (payload?.userId ?? '').trim()
    if (!userId) {
      authContext.clear()
      logger.info('AUTH_SET_CONTEXT cleared', 'Auth')
      return {ok: true}
    }
      // baseUrl 必須由 renderer 帶上:VITE_* 只注入 renderer 編譯期,主進程 process.env 讀不到,
      // 不帶就會 fallback 到 localhost:5247,導致子視窗(備忘/日誌)連不上正式後端。
      authContext.set(userId, payload?.token ?? '', payload?.baseUrl)
      logger.info(`AUTH_SET_CONTEXT set userId=${userId} baseUrl=${payload?.baseUrl ?? '(default)'}`, 'Auth')
    return {ok: true}
  })
}
