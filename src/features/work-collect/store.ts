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
import type {WorkCollectTickPayload, WorkRecord, WorkResultPayload, WorkSyncRecordItem,} from './types'

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
        screenshotHash: payload.screenshotHash ?? null,
        reason: result.reason ?? null,
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

    // ── 集中化(docs/20):config 拉取 + sync 上傳 ──────────────────────

    /**
     * server 配置同步:
     *   1. HTTP GET /my-config
     *   2. IPC applyRemoteConfig → main 寫入 ConfigManager + 視變更重啟 scheduler
     *
     * 失敗只 log;網路不通就等下次觸發(啟動 / 第二天 8 點)。
     */
    async function onConfigRequest() {
        try {
            const remote = await workCollectApi.getMyConfig()
            const result = await window.electronAPI.workCollect.applyRemoteConfig({
                enabled: remote.enabled,
                intervalMinutes: remote.intervalMinutes,
                workStartHour: remote.workStartHour,
                workEndHour: remote.workEndHour,
                version: remote.version,
            })
            // 配置變了 → 重新 load 一次,讓 configStore.appConfig 對齊本地剛寫的 DB
            if (result.changed) {
                await useConfigStore().loadConfig()
                logger.info(`已套用 server 配置 v${remote.version}`, 'WorkCollectStore')
            }
        } catch (err) {
            logger.warn('拉取 server 配置失敗,等下次觸發', 'WorkCollectStore', err)
        }
    }

    /**
     * 批次同步本地未上傳紀錄到 server。
     *
     * 流程:
     *   1. IPC 撈 unsynced(每批最多 200)
     *   2. 轉成 sync-daily 上傳格式(localId = 本地 record.id)
     *   3. POST,拿回 successLocalIds
     *   4. IPC mark 已同步
     *   5. 若還有未傳就遞迴繼續(超過 5 批中斷,留下次觸發,避免無限 loop)
     *
     * 失敗只 log,留給下次觸發(work-end / safety-net / 重啟)再試。
     */
    async function syncDailyRecords(): Promise<void> {
        for (let round = 0; round < 5; round++) {
            let chunk: WorkRecord[] = []
            try {
                chunk = (await window.electronAPI.workCollect.listUnsynced(200)) as WorkRecord[]
            } catch (err) {
                logger.warn('撈 unsynced 失敗', 'WorkCollectStore', err)
                return
            }
            if (!chunk || chunk.length === 0) {
                logger.debug('本地無未同步紀錄,sync 結束', 'WorkCollectStore')
                return
            }

            const records: WorkSyncRecordItem[] = chunk.map((r) => ({
                localId: r.id,
                capturedAt: r.capturedAt,
                activeApp: r.activeApp,
                activeWindowTitle: r.activeWindowTitle,
                category: r.category,
                description: r.description,
                confidence: r.confidence,
                screenshotHash: r.screenshotHash,
                reason: r.reason,
            }))

            try {
                const resp = await workCollectApi.syncDaily(records)
                // 只標 success(本次真插入)+ duplicate(server 已有),
                // failed 留下次觸發補傳。舊版用 duplicates count > 0 推斷整批已收 →
                // 在「全部失敗 + 0 duplicate」邊界會誤標,已修正。
                const toMark = [
                    ...(resp.successLocalIds ?? []),
                    ...(resp.duplicateLocalIds ?? []),
                ]
                if (toMark.length > 0) {
                    await window.electronAPI.workCollect.markSynced(toMark, resp.syncedAt ?? Date.now())
                }
                const failedCount = (resp.failedLocalIds ?? []).length
                logger.info(
                    `sync-daily 完成 success=${resp.successLocalIds?.length ?? 0} duplicate=${resp.duplicateLocalIds?.length ?? 0} failed=${failedCount} marked=${toMark.length}`,
                    'WorkCollectStore'
                )
                if (failedCount > 0) {
                    logger.warn(`sync-daily 有 ${failedCount} 筆失敗,等下次觸發重傳`, 'WorkCollectStore')
                }
                if (chunk.length < 200) return // 已撈乾淨
            } catch (err) {
                logger.warn('sync-daily HTTP 失敗,等下次觸發', 'WorkCollectStore', err)
                return
            }
        }
        logger.info('sync-daily 達 5 批上限,剩餘留下次觸發', 'WorkCollectStore')
    }

    function onSyncRequest(...args: unknown[]) {
        const payload = args[0] as { reason?: string } | undefined
        logger.info(`收到 sync request reason=${payload?.reason ?? 'unknown'}`, 'WorkCollectStore')
        syncDailyRecords().catch((err) => {
            logger.warn('syncDailyRecords 異常', 'WorkCollectStore', err)
        })
    }

  /**
   * 訂閱主進程推送。冪等 —— 多次呼叫不會重複註冊(用模組級 flag 守住)。
   * App.vue mount 後呼叫一次即可。
   */
  function bootstrap(): void {
    if (subscribed) return
    window.electronAPI.on(IpcChannels.PUSH_WORK_COLLECT_TICK, onTick)
    window.electronAPI.on(IpcChannels.PUSH_WORK_RECORD_NEW, onRecordNew)
      // 集中化:訂閱 main 推來的 config / sync request
      window.electronAPI.on(IpcChannels.PUSH_WORK_COLLECT_CONFIG_REQUEST, onConfigRequest)
      window.electronAPI.on(IpcChannels.PUSH_WORK_COLLECT_SYNC_REQUEST, onSyncRequest)
    subscribed = true

      // 修正 #6:訂閱完成 ack 給 main,讓 main 補推任何 pending request,
      // 處理「main 已推但 renderer 未訂閱」的開機競態。
      // 失敗不阻塞 — 若 main 沒實作此 channel,只是退化成「等下次 tick 觸發」。
      window.electronAPI.workCollect
          .notifyReady()
          .catch((err) => logger.warn('notifyReady 失敗,等下次觸發', 'WorkCollectStore', err))
  }

    return {
        enabled, intervalMinutes, workHours, records, loading,
        toggle, refresh, bootstrap, syncDailyRecords,
    }
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

