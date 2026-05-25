/**
 * 工作採集 Pinia store。
 *
 * 職責:
 *  - 鏡像 config.workCollect.{enabled, intervalMinutes, workHours},提供 UI 讀取
 *  - 訂閱主進程 PUSH_WORK_COLLECT_TICK,負責呼叫後端 AI(走 createHttpClient,複用 auth)
 *    拿到結果後 IPC 回送給主進程寫 DB
 *  - 訂閱主進程 PUSH_WORK_RECORD_NEW,DB 寫入後重 query 當天紀錄
 *  - 對外提供 toggle(enabled) / refresh()
 *
 * bootstrap() 一定要在 App.vue mount 時呼叫一次,否則 tick push 沒人接 → 採集白做。
 */

import {defineStore} from 'pinia'
import {computed, ref} from 'vue'
import {useConfigStore} from '@/stores/config.store'
import {logger} from '@/utils/logger'
import {IpcChannels} from '@shared/ipc-channels'
import {workCollectApi} from './api'
import type {WorkCollectTickPayload, WorkRecord, WorkResultPayload} from './types'

export const useWorkCollectStore = defineStore('workCollect', () => {
  const configStore = useConfigStore()

  /** 採集總開關;鏡像 config.workCollect.enabled */
  const enabled = computed<boolean>(() => configStore.appConfig?.workCollect?.enabled ?? false)

  /** 採集間隔(分鐘),只讀 */
  const intervalMinutes = computed<number>(
    () => configStore.appConfig?.workCollect?.intervalMinutes ?? 5
  )

  /** 工時範圍,給 UI 顯示「採集時段 08:00-17:00」 */
  const workHours = computed(() => ({
    start: configStore.appConfig?.workCollect?.workStartHour ?? 8,
    end: configStore.appConfig?.workCollect?.workEndHour ?? 17,
  }))

  /** 當前查詢區間的紀錄(時間軸 UI 用) */
  const records = ref<WorkRecord[]>([])
  const loading = ref(false)

  /** 切換採集開關 */
  async function toggle(next: boolean): Promise<void> {
    try {
      await window.electronAPI.workCollect.toggle(next)
      // 主進程已寫 config,renderer 端 cache 要重 load 讓 enabled computed 更新
      await configStore.loadConfig()
      logger.info(`工作採集切換為 ${next ? '啟用' : '停用'}`, 'WorkCollectStore')
    } catch (err) {
      logger.error('切換工作採集失敗', 'WorkCollectStore', err)
      throw err
    }
  }

  /**
   * 查詢時間區間的紀錄。
   * 預設範圍:過去 30 天 → now,讓 TimelineList 的日期選擇器有歷史可挑;
   * 各 chart 元件仍會用各自的 filter(filterTodayRecords / filterWeekRecords)截短自己要的範圍。
   */
  async function refresh(since?: number, until?: number): Promise<void> {
    loading.value = true
    try {
      const start = since ?? startOfDaysAgo(30)
      const end = until ?? Date.now()
      records.value = await window.electronAPI.workCollect.list({since: start, until: end})
    } catch (err) {
      logger.error('查詢採集紀錄失敗', 'WorkCollectStore', err)
      records.value = []
    } finally {
      loading.value = false
    }
  }

  /**
   * 處理主進程 tick 推送:
   *  1. 把 jpeg 上傳給後端 AI
   *  2. 把分析結果 IPC 回送 main,由 handler 寫 DB
   *  3. DB 寫完 main 會推 PUSH_WORK_RECORD_NEW,onRecordNew 接住自動 refresh
   *
   * 整個流程不阻塞 UI;失敗只記 log,不彈 toast(採集是背景行為,不該打擾使用者)。
   */
  async function onTick(...args: unknown[]) {
    const payload = args[0] as WorkCollectTickPayload | undefined
    if (!payload) return

    try {
      const result = await workCollectApi.analyze(
        payload.jpeg,
        payload.activeWindow,
        payload.appName,
        payload.allWindows,
        payload.capturedAt
      )

      const resultPayload: WorkResultPayload = {
        capturedAt: payload.capturedAt,
        activeApp: payload.appName || null,
        activeWindowTitle: payload.activeWindow || null,
        category: result.category,
        description: result.description,
        confidence: result.confidence,
      }
      window.electronAPI.workCollect.sendResult(resultPayload)

      logger.debug(`tick 已分析完成 category=${result.category}`, 'WorkCollectStore')
    } catch (err) {
      logger.warn('AI 分析失敗,此次 tick 丟棄', 'WorkCollectStore', err)
    }
  }

  /** 主進程 DB 寫入完成 → 重 query 流水線 */
  function onRecordNew() {
    refresh().catch(() => undefined)
  }

  /**
   * 訂閱主進程推送。冪等 —— 多次呼叫不會重複註冊(用模組級 flag 守住)。
   * App.vue mount 後呼叫一次即可。
   */
  function bootstrap(): void {
    if (subscribed) return
    window.electronAPI.on(IpcChannels.PUSH_WORK_COLLECT_TICK, onTick)
    window.electronAPI.on(IpcChannels.PUSH_WORK_RECORD_NEW, onRecordNew)
    subscribed = true
  }

  return {enabled, intervalMinutes, workHours, records, loading, toggle, refresh, bootstrap}
})

// ── 模組級狀態 ──────────────────────────────────────────────────
/**
 * 訂閱旗標。Pinia store 在 HMR 下可能 dispose + recreate,但 window.electronAPI.on 的
 * 監聽器不會跟著清,所以用模組級 flag 守住「整個 renderer 生命週期只訂一次」。
 */
let subscribed = false

/** N 天前 00:00:00 的 Unix ms */
function startOfDaysAgo(days: number): number {
  const d = new Date()
  d.setDate(d.getDate() - days)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

