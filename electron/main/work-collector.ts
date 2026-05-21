/**
 * 工作自動採集 Scheduler。
 *
 * 在主進程跑 setInterval,每隔 N 分鐘:
 *  1. 檢查總開關 + 工時區間 + 螢幕鎖狀態 → 任一不符就 skip
 *  2. desktopCapturer 擷取 primary 螢幕截圖 + 所有可見視窗標題清單
 *  3. multipart POST 到後端 AI 接口,拿到 category / description / confidence
 *  4. WorkRecordService.insert 寫進 SQLite work_records 表
 *  5. webContents.send 通知渲染端刷新流水線
 *
 * 截圖端到端不落地:
 *  - 桌面端:只活在 tick() 函式作用域的 Buffer,送完 GC 回收,絕不 fs.write
 *  - 後端:處理完即丟,不寫磁碟、不寫 DB
 *
 * 設計文件:[docs/11-工作自動採集設計.md](../../docs/11-工作自動採集設計.md)
 */

import {desktopCapturer, powerMonitor, screen} from 'electron'
import {Buffer} from 'buffer'
import {logger} from './utils/logger'
import {IpcChannels} from '../shared/ipc-channels'
import type {ConfigManager} from './config-manager'
import type {WindowManager} from './window-manager'
import type {WorkRecordService} from './db/services/work-record.service'
import type {WorkCategory} from './db/schema/work-records'

/** 後端 AI 接口的回傳體(對齊 tmbom WorkCollectAnalyzeResponse) */
interface AnalyzeResponse {
  category: WorkCategory
  description: string
  confidence: number
}

/** 後端 unified response 包裝(對齊 ApiControllerBase.Success → { code, message, data }) */
interface UnifiedResponse<T> {
  code: number
  message: string
  data: T
}

export class WorkCollectorScheduler {
  private timer: NodeJS.Timeout | null = null

  /** 螢幕鎖狀態,由 powerMonitor 事件維護;app 啟動時假設未鎖 */
  private isScreenLocked = false

  /** Auth Token 由渲染端登入後 IPC 設給主進程,沒 token 時跳過採集 */
  private accessToken: string | null = null

  /** 後端 API base URL(VITE_REPAIR_API_URL),由渲染端 IPC 一併送來 */
  private apiBaseUrl: string | null = null

  constructor(
    private readonly cfg: ConfigManager,
    private readonly svc: WorkRecordService,
    private readonly winMgr: WindowManager
  ) {
    // 訂閱螢幕鎖事件:鎖屏期間整個 tick 跳過,不擷取截圖也不上傳
    powerMonitor.on('lock-screen', () => {
      this.isScreenLocked = true
      logger.info('螢幕已鎖,工作採集暫停', 'WorkCollector')
    })
    powerMonitor.on('unlock-screen', () => {
      this.isScreenLocked = false
      logger.info('螢幕已解鎖,工作採集恢復', 'WorkCollector')
    })
  }

  /**
   * 由渲染端登入成功 / app 啟動時同步過來:
   *  - token:JWT,主進程 fetch 帶 Authorization
   *  - apiBaseUrl:從渲染端的 VITE_REPAIR_API_URL 拿,主進程沒 import.meta.env 機制
   * 任一為 null 時 tick 會跳過,不打不存在的網址。
   */
  setAuthContext(token: string | null, apiBaseUrl: string | null): void {
    this.accessToken = token
    this.apiBaseUrl = apiBaseUrl
  }

  /** 啟動採集。讀 config 看 enabled 跟 intervalMinutes */
  start(): void {
    const c = this.cfg.getConfig().workCollect
    if (!c?.enabled) {
      logger.info('工作採集未啟用,scheduler 不啟動', 'WorkCollector')
      return
    }
    if (this.timer) return // 已啟動,不重複

    const intervalMs = Math.max(1, c.intervalMinutes ?? 5) * 60_000
    this.timer = setInterval(() => void this.tick(), intervalMs)
    logger.info(`工作採集已啟動,間隔 ${intervalMs / 60_000} 分鐘`, 'WorkCollector')
  }

  /** 停止採集(關閉開關時 / app 退出時呼叫) */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
      logger.info('工作採集已停止', 'WorkCollector')
    }
  }

  /** 配置變動(間隔 / 工時範圍 / 開關)後呼叫 */
  restart(): void {
    this.stop()
    this.start()
  }

  /** 單次採集流程,每 N 分鐘執行一次 */
  private async tick(): Promise<void> {
    try {
      // 1. 螢幕鎖 → 跳過
      if (this.isScreenLocked) {
        logger.debug('螢幕鎖中,tick skip', 'WorkCollector')
        return
      }

      // 2. 工時區間 → 跳過
      if (!this.isInWorkHours()) {
        logger.debug('非工時,tick skip', 'WorkCollector')
        return
      }

      // 3. 沒登入 token / 沒 API base → 跳過
      if (!this.accessToken || !this.apiBaseUrl) {
        logger.debug('Auth context 未就緒,tick skip', 'WorkCollector')
        return
      }

      // 4. 截圖(只擷主螢幕,Buffer 只活在此函式作用域)
      const screenshotJpeg = await this.captureScreenshot()

      // 5. 所有可見視窗標題(thumbnailSize 0 = 跳過縮圖節省 CPU)
      const allWindowTitles = await this.collectVisibleWindowTitles()

      // 6. 焦點視窗:用 desktopCapturer 結果第一個作近似;DashScope 看截圖能糾錯
      //    這樣不用引 active-win native module,簡化部署
      const activeTitle = allWindowTitles[0] ?? ''
      const activeApp = this.extractAppHint(activeTitle)

      // 7. multipart 上傳給後端 AI
      const result = await this.analyzeOnBackend({
        screenshotJpeg,
        activeWindow: activeTitle,
        appName: activeApp,
        allWindows: allWindowTitles,
      })
      if (!result) return

      // 8. 寫進本機 DB
      this.svc.insert({
        capturedAt: Date.now(),
        activeApp,
        activeWindowTitle: activeTitle,
        category: result.category,
        description: result.description,
        confidence: result.confidence,
      })

      // 9. 推送渲染端刷新流水線
      this.winMgr
        .getMainWindow()
        ?.webContents.send(IpcChannels.PUSH_WORK_RECORD_NEW)

      logger.debug(`採集寫入完成 category=${result.category}`, 'WorkCollector')
    } catch (err) {
      // tick 失敗只記 log,等下一輪重試,不擴散
      logger.warn('採集 tick 失敗', 'WorkCollector', err)
    }
  }

  /** 判斷現在是否在工時區間內([startHour, endHour),含 start 不含 end) */
  private isInWorkHours(): boolean {
    const c = this.cfg.getConfig().workCollect
    const start = c?.workStartHour ?? 8
    const end = c?.workEndHour ?? 17
    const hour = new Date().getHours()
    return hour >= start && hour < end
  }

  /** 擷取 primary 螢幕 jpeg(quality 70 平衡大小與清晰度) */
  private async captureScreenshot(): Promise<Buffer> {
    const {width, height} = screen.getPrimaryDisplay().workAreaSize
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: {width, height},
    })
    return sources[0].thumbnail.toJPEG(70)
  }

  /**
   * 列出所有可見視窗的標題(thumbnailSize 0 跳過縮圖產生,只要 name 節省 CPU)。
   * 排除自家 app(避免雜訊),最多 10 個。
   */
  private async collectVisibleWindowTitles(): Promise<string[]> {
    const sources = await desktopCapturer.getSources({
      types: ['window'],
      thumbnailSize: {width: 0, height: 0},
    })
    return sources
      .map((s) => s.name)
      .filter((name) => name && !/ichia ?desktop/i.test(name))
      .slice(0, 10)
  }

  /** 從視窗標題猜 app 名(粗略,給後端當輔助訊號;主要還是靠截圖) */
  private extractAppHint(title: string): string {
    // 常見格式 "filename - App Name" → 取最後一段
    const parts = title.split(' - ')
    return parts.length > 1 ? parts[parts.length - 1].trim() : title
  }

  /** 打後端 AI 分析接口,失敗回 null */
  private async analyzeOnBackend(payload: {
    screenshotJpeg: Buffer
    activeWindow: string
    appName: string
    allWindows: string[]
  }): Promise<AnalyzeResponse | null> {
    // baseUrl 由渲染端透過 IPC 設進來,tick() 前已確認 non-null
    const url = `${this.apiBaseUrl}/api/WorkCollect/analyze`

    const form = new FormData()
    // jpeg Buffer → Blob,multipart 必需走 Blob 或 File 才會被當二進位處理。
    // Node Buffer / view 都帶 ArrayBufferLike(可能是 SharedArrayBuffer),DOM Blob 嚴格只收 ArrayBuffer。
    // 配 jpeg 一次,只跑一次拷貝(複製到全新 ArrayBuffer),~150KB 影響可忽略,TS 也乾淨。
    const jpegCopy = new Uint8Array(payload.screenshotJpeg.byteLength)
    jpegCopy.set(payload.screenshotJpeg)
    form.append('screenshot', new Blob([jpegCopy], {type: 'image/jpeg'}), 'screenshot.jpg')
    form.append('activeWindow', payload.activeWindow)
    form.append('appName', payload.appName)
    form.append('allWindows', JSON.stringify(payload.allWindows))
    form.append('capturedAt', String(Date.now()))

    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: {Authorization: `Bearer ${this.accessToken}`},
        body: form,
      })
      if (!resp.ok) {
        logger.warn(`AI 分析接口 HTTP ${resp.status}`, 'WorkCollector')
        return null
      }
      const json = (await resp.json()) as UnifiedResponse<AnalyzeResponse>
      if (json.code !== 200 || !json.data) {
        logger.warn(`AI 分析業務碼異常 code=${json.code} msg=${json.message}`, 'WorkCollector')
        return null
      }
      return json.data
    } catch (err) {
      logger.warn('AI 分析接口呼叫失敗', 'WorkCollector', err as Error)
      return null
    }
  }

  /** dispose:跟其他 manager 一致,gracefulShutdown 內呼叫 */
  dispose(): void {
    this.stop()
  }
}
