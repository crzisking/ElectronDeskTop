/**
 * 工作採集 Pinia store。
 *
 * State:
 *  - enabled:當前開關狀態(從 configStore 鏡像,UI 切換時走 toggle action)
 *  - records:當天的採集紀錄(按時間升序)
 *  - loading:正在 query DB 的旗標
 *
 * 訂閱主進程 PUSH_WORK_RECORD_NEW:scheduler 寫入新紀錄後刷新 records。
 */

import {defineStore} from 'pinia'
import {computed, ref} from 'vue'
import {workCollectApi} from '@/api/modules/work-collect.api'
import {useConfigStore} from '@/stores/config.store'
import {useAuthStore} from '@/stores/auth.store'
import {logger} from '@/utils/logger'
import {IpcChannels} from '@shared/ipc-channels'
import type {WorkRecord} from '@/types/work-record.types'

export const useWorkCollectStore = defineStore('workCollect', () => {
  const configStore = useConfigStore()
  const authStore = useAuthStore()

  /** 採集總開關;鏡像 config.workCollect.enabled,動作走 toggle() */
  const enabled = computed<boolean>(() => configStore.appConfig?.workCollect?.enabled ?? false)

  /** 採集間隔(分鐘),只讀 */
  const intervalMinutes = computed<number>(
    () => configStore.appConfig?.workCollect?.intervalMinutes ?? 5
  )

  /** 工時範圍,只讀,給 UI 顯示「採集時段 08:00-17:00」 */
  const workHours = computed(() => ({
    start: configStore.appConfig?.workCollect?.workStartHour ?? 8,
    end: configStore.appConfig?.workCollect?.workEndHour ?? 17,
  }))

  /** 當前查詢區間的紀錄 */
  const records = ref<WorkRecord[]>([])
  const loading = ref(false)

  /**
   * 切換開關。內部:
   *  1. invoke 主進程 toggle(寫 config + 啟停 scheduler)
   *  2. 重新 load config,讓 enabled computed 拿到新值
   */
  async function toggle(next: boolean): Promise<void> {
    try {
      await workCollectApi.toggle(next)
      // 主進程已經寫 config,但 configStore 在渲染端有 cache,要重 load 讓 computed 更新
      await configStore.loadConfig()
      logger.info(`工作採集切換為 ${next ? '啟用' : '停用'}`, 'WorkCollectStore')
    } catch (err) {
      logger.error('切換工作採集失敗', 'WorkCollectStore', err)
      throw err
    }
  }

  /** 查詢時間區間的紀錄(預設今日 00:00 - now) */
  async function refresh(since?: number, until?: number): Promise<void> {
    loading.value = true
    try {
      const start = since ?? startOfToday()
      const end = until ?? Date.now()
      records.value = await workCollectApi.list(start, end)
    } catch (err) {
      logger.error('查詢採集紀錄失敗', 'WorkCollectStore', err)
      records.value = []
    } finally {
      loading.value = false
    }
  }

  /**
   * 同步 auth 到主進程 + 啟動 push 訂閱。
   * App.vue / WorkCollectView 任一處進入時都應呼叫一次(冪等)。
   */
  function bootstrap(): void {
    // 把當前 token 推給主進程;登出後 token = null,scheduler 自動 skip
    workCollectApi.syncAuth(authStore.accessToken)

    // 訂閱推播(主進程寫進新紀錄後通知)。重複訂閱會被既有的 listenerMap 機制覆蓋,
    // 但保險還是只訂一次:用模組級 flag。
    if (!pushSubscribed) {
      window.electronAPI.on(IpcChannels.PUSH_WORK_RECORD_NEW, onRecordPush)
      pushSubscribed = true
    }
  }

  function onRecordPush() {
    // 主進程說有新紀錄,渲染端重 query 今日資料
    refresh().catch(() => undefined)
  }

  return {
    enabled,
    intervalMinutes,
    workHours,
    records,
    loading,
    toggle,
    refresh,
    bootstrap,
  }
})

// ── 模組級 helpers ──────────────────────────────────────────────────
let pushSubscribed = false

function startOfToday(): number {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}
