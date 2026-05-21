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

import {createHttpClient} from '@/api/http-client'
import type {WorkAnalyzeResponse} from './types'

// 走 VITE_WORK_COLLECT_API_URL,跟 repair 解耦(雖然當前指向同一個 tmbom 後端,
// 但語義上 work-collect 應該有自己的環境變數,日後拆服務不必動代碼)。
const WORK_BASE_URL: string =
  (import.meta.env.VITE_WORK_COLLECT_API_URL as string | undefined) ?? 'http://localhost:5247'

let _client: ReturnType<typeof createHttpClient> | null = null
function getClient() {
  if (!_client) {
    _client = createHttpClient(WORK_BASE_URL, 30000)
  }
  return _client
}

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
    capturedAt: number
  ): Promise<WorkAnalyzeResponse> {
    const form = new FormData()
    // IPC 過來的 Uint8Array 底層可能是 ArrayBufferLike(TS 嚴格認為含 SharedArrayBuffer),
    // DOM Blob 只接 ArrayBuffer。複製一份到全新 ArrayBuffer 上的 Uint8Array,
    // ~150KB 一次拷貝可忽略,換 TS 通過 + 跨進程邊界安全。
    const jpegCopy = new Uint8Array(jpeg.byteLength)
    jpegCopy.set(jpeg)
    form.append('screenshot', new Blob([jpegCopy], {type: 'image/jpeg'}), 'screenshot.jpg')
    form.append('activeWindow', activeWindow)
    form.append('appName', appName)
    form.append('allWindows', JSON.stringify(allWindows))
    form.append('capturedAt', String(capturedAt))

    return await getClient().post<WorkAnalyzeResponse>('/api/WorkCollect/analyze', form)
  },
}
