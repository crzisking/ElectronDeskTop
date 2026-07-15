/**
 * 工作自動採集 — 後端 AI 分析 API。
 *
 * 走 createHttpClient,複用:
 *  - Auth 攔截器(自動帶 JWT)
 *  - 統一錯誤處理
 *  - 超時設定
 *
 * 採集 tick 由主進程 scheduler 觸發,store 訂閱 PUSH_WORK_COLLECT_TICK 後呼叫本模組的
 * analyze(),拿到結果再透過 electronAPI.workCollect.sendResult() 回送主進程寫 DB。
 *
 * 本機 DB 的 list / 開關 toggle 走 IPC,不走 HTTP(看 store)。
 */

import {httpClientFor} from '@/api/http-client'
import {BACKEND_BASE_URL} from '@/shared/config/backend'
import {scheduleRequest} from './request-scheduler'
import type {WorkAnalyzeResponse, WorkConfigResponse} from './types'

// export:集中化 sync 後 store 要把 base URL 透過 IPC 帶給 main(main 沒讀 vite env)
export const WORK_COLLECT_BASE_URL = BACKEND_BASE_URL

const getClient = () => httpClientFor(WORK_COLLECT_BASE_URL, 30000)

export const workCollectApi = {
  /**
   * 上傳一次採集到的截圖 + 視窗清單,後端 Qwen-VL 回類別 + 描述。
   *
   * @param jpeg jpeg 二進位內容(主進程 desktopCapturer 產出)
   * @param activeWindow 前台視窗標題
   * @param appName 應用名(從標題抽出)
   * @param allWindows 所有可見視窗標題清單
   * @param capturedAt 採集時間 Unix ms
   */
  async analyze(
    jpeg: Uint8Array,
    activeWindow: string,
    appName: string,
    allWindows: string[],
    capturedAt: number,
    userName: string,
    prompt: string,
    allowedCodes: string[],
  ): Promise<WorkAnalyzeResponse> {
    const form = new FormData()
    // IPC 過來的 Uint8Array 底層可能是 ArrayBufferLike(TS 嚴格認為含 SharedArrayBuffer),
    // DOM Blob 只接 ArrayBuffer。複製一份到全新 ArrayBuffer 上的 Uint8Array,
    // ~150KB 一次拷貝可忽略,換 TS 通過 + 跨進程邊界安全。
    const jpegCopy = new Uint8Array(jpeg.byteLength)
    jpegCopy.set(jpeg)
    form.append('screenshot', new Blob([jpegCopy], {type: 'image/jpeg'}), 'screenshot.jpg')
      // 工號:後端 [AllowAnonymous] 取不到 CurrentUser,由前端從 JWT 解出顯式帶上
      form.append('userName', userName)
    form.append('activeWindow', activeWindow)
    form.append('appName', appName)
    form.append('allWindows', JSON.stringify(allWindows))
    form.append('capturedAt', String(capturedAt))
    // 模板移到 client(docs/23 Phase A):main 組好的 prompt + 白名單透傳給 server
    form.append('prompt', prompt)
    form.append('allowedCodes', JSON.stringify(allowedCodes))

    // analyze:走 15s 散佈窗口,壓平整點對齊的瞬時峰值,又不至於拖太久回 UI
    return await scheduleRequest(
        () => getClient().post<WorkAnalyzeResponse>('/api/WorkCollect/analyze', form),
        {profile: 'analyze', label: 'analyze'},
    )
  },

  /**
   * 拉當前使用者的 server 端配置(管理員可改的那份)。
   * 啟動時 + 每天首次 tick 進工時前各拉一次。
   * 比對 version,新版本就覆蓋本地 config + scheduler 重啟。
   */
  async getMyConfig(userName: string): Promise<WorkConfigResponse> {
    // config 拉取多半 08:00 / 啟動時集中發生,走 25s 散佈窗口削峰
      // 工號當 query 參數傳(後端 AllowAnonymous 取不到 CurrentUser)
    return await scheduleRequest(
        () => getClient().get<WorkConfigResponse>('/api/WorkCollect/my-config', {params: {userName}}),
        {profile: 'config', label: 'getMyConfig'},
    )
  },

  /**
   * 使用者自助調整自己的採集時間(僅 interval / workStartHour / workEndHour)。
   * 與管理端寫同一行 Work_User_Configs(UpdatedBy='self');回最新完整配置,
   * caller 直接拿去走 applyRemoteConfig,跟「拉 my-config」同一條生效路徑。
   */
  async updateMySchedule(
      userName: string,
      patch: { intervalMinutes?: number; workStartHour?: number; workEndHour?: number },
  ): Promise<WorkConfigResponse> {
    // 用戶手動操作,單發不需要削峰窗口,直接打
    return await getClient().patch<WorkConfigResponse>('/api/WorkCollect/my-config', patch, {params: {userName}})
  },

  // syncDaily 已搬至主進程(electron/main/work-collect/sync-service.ts)。
  // renderer 不再直接打 /sync-daily HTTP — 走 electronAPI.workCollect.runSync 即可。
}
