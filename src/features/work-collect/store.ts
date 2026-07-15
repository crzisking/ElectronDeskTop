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
import {useAuthStore} from '@/stores/auth.store'
import {logger} from '@/shared/utils/logger'
import {IpcChannels} from '@shared/ipc-channels'
import {WORK_COLLECT_BASE_URL, workCollectApi} from './api'
import {
    getCategoryColor as getCategoryColorFallback,
    getCategoryLabel as getCategoryLabelFallback,
} from './category-colors'
import type {
    WorkCollectTickPayload,
    WorkConfigResponse,
    WorkRecord,
    WorkResultPayload,
    WorkTemplateDetail,
    WorkTemplateItem,
} from './types'

export const useWorkCollectStore = defineStore('workCollect', () => {
  const configStore = useConfigStore()
    const authStore = useAuthStore()

    /**
     * 當前登入工號(從 JWT 解析後存在 authStore.user.userName)。
     * 後端 work-collect 接口 [AllowAnonymous] 取不到 CurrentUser,所有上報都要顯式帶這個。
     *
     * dev 模式下若沒登入(`npm run dev` 跳過登入流程),允許用 VITE_DEV_USERNAME 兜底,
     * 在 .env.development 配你的工號。生產環境(import.meta.env.PROD)即使設了也不生效,
     * 避免打包後上線假冒身份。
     */
    const currentUserName = (): string => {
        const real = authStore.userName
        if (real) return real
        if (!import.meta.env.PROD) {
            const devUser = (import.meta.env.VITE_DEV_USERNAME as string | undefined) ?? ''
            if (devUser) return devUser.trim()
        }
        return ''
    }

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

    /**
     * 模板分類 code → label / color 對照表(reactive)。
     *
     * 為什麼存在:work_records 表只記 category code(DB_OPS / CODING / ...),label 跟 color
     * 都是模板配置隨時可改,設計上不冗餘存進每筆紀錄。UI 顯示中文名 + 配色,靠這兩張對照表
     * 即時 lookup。模板改名 / 改色 → cache 更新 → UI 自動跟著變,歷史紀錄不需 migrate。
     *
     * 來源兩條路徑,都走 setCategoryMetaFromTemplate():
     *   1. bootstrap() 啟動時 IPC getTemplate() 拉一次(現有 cache)
     *   2. onConfigRequest() 收到 /my-config 的 templateDetail 順手更新(最新模板)
     *
     * 走 reactive 不走純 plain object — 模板熱更新時所有 computed/template 自動 re-evaluate。
     */
    const categoryLabels = ref<Record<string, string>>({})
    const categoryColors = ref<Record<string, string>>({})

    /**
     * 取分類顯示 label:先查模板 cache → 沒命中走 category-colors.ts 的 legacy fallback chain。
     * 所有 UI 元件、charts、export 都該用這個,不要直接呼叫 getCategoryLabelFallback。
     */
    function labelOf(code: string): string {
        if (!code) return getCategoryLabelFallback(code)
        return categoryLabels.value[code] ?? getCategoryLabelFallback(code)
    }

    /**
     * 取分類顯示色:先查模板 cache(管理員可在 tmbomweb 配置 item.color)→
     * 沒命中再走 legacy 字典 / hash palette fallback。
     *
     * 為什麼重要:沒這層 lookup 的話,模板自訂的 code(CODING / DOCS 等)只能走 hash palette,
     * 不同 code 容易撞到相近色(例如兩個暖色),donut 圖肉眼難分辨。
     */
    function colorOf(code: string): string {
        if (!code) return getCategoryColorFallback(code)
        return categoryColors.value[code] ?? getCategoryColorFallback(code)
    }

    /** 把模板 items 抽成 code → {label, color} 對照表,塞進 reactive state */
    function setCategoryMetaFromTemplate(detail: WorkTemplateDetail | null): void {
        if (!detail || !Array.isArray(detail.items)) {
            categoryLabels.value = {}
            categoryColors.value = {}
            return
        }
        const labels: Record<string, string> = {}
        const colors: Record<string, string> = {}
        for (const item of detail.items as WorkTemplateItem[]) {
            // 不過濾 isActive:UI 仍可能顯示已停用 code 的歷史紀錄,有 label / color 就該用
            if (item?.code) {
                if (item.label) labels[item.code] = item.label
                if (item.color) colors[item.code] = item.color
            }
        }
        categoryLabels.value = labels
        categoryColors.value = colors
    }

    /** bootstrap 內呼叫:IPC 從 main 拉一次現有 cache(沒拉到 server config 時會回 null) */
    async function loadCategoryMetaFromCache(): Promise<void> {
        try {
            const detail = await window.electronAPI.workCollect.getTemplate()
            setCategoryMetaFromTemplate(detail as WorkTemplateDetail | null)
        } catch (err) {
            logger.warn('讀取模板 cache 失敗(忽略,UI 走 fallback)', 'WorkCollectStore', err)
        }
    }

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
   *
   * 重入保護:HTTP 卡 / 後端慢時前一輪 analyze 還沒結束又收到新 tick,
   * 直接丟掉本輪。截圖在 main 端產生時已是當下狀態,延後再分析意義不大。
   */
  async function onTick(...args: unknown[]) {
    const payload = args[0] as WorkCollectTickPayload | undefined
    if (!payload) return

      if (analyzingInflight) {
          logger.debug('前一輪 analyze 還在跑,跳過本輪 tick', 'WorkCollectStore')
          return
      }
      analyzingInflight = true

    try {
      const result = await workCollectApi.analyze(
        payload.jpeg,
        payload.activeWindow,
        payload.appName,
        payload.allWindows,
          payload.capturedAt,
          currentUserName(),
          payload.prompt ?? '',
          payload.allowedCodes ?? [],
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
    } finally {
        analyzingInflight = false
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
    /**
     * 把 server 回的完整配置套到本地(main 寫 KV + 視變更重啟排程 + 模板入 cache)。
     * 拉取(onConfigRequest)與自助修改(updateSchedule)共用同一條生效路徑。
     */
    async function applyRemote(remote: WorkConfigResponse): Promise<void> {
        const result = await window.electronAPI.workCollect.applyRemoteConfig({
            enabled: remote.enabled,
            intervalMinutes: remote.intervalMinutes,
            workStartHour: remote.workStartHour,
            workEndHour: remote.workEndHour,
            version: remote.version,
            categoryTemplateId: remote.categoryTemplateId ?? null,
            templateName: remote.templateName ?? null,
            // 整份 templateDetail 透傳到 main → 落 work_template_cache,後續 tick 本地組 prompt
            templateDetail: remote.templateDetail ?? null,
        })
        // 配置變了 → 重新 load 一次,讓 configStore.appConfig 對齊本地剛寫的 DB
        if (result.changed) {
            await useConfigStore().loadConfig()
            logger.info(`已套用 server 配置 v${remote.version}`, 'WorkCollectStore')
        }
        // 不管 config 有沒有「變」,template 都該以 server 最新值為準同步進 reactive map
        // (例如管理員只改 label / color 沒動 enabled/interval,result.changed 會是 false 但要更新)
        setCategoryMetaFromTemplate(remote.templateDetail ?? null)
    }

    async function onConfigRequest() {
        const userName = currentUserName()
        if (!userName) {
            logger.warn('未登入(無工號),跳過拉取 config', 'WorkCollectStore')
            return
        }
        try {
            await applyRemote(await workCollectApi.getMyConfig(userName))
        } catch (err) {
            logger.warn('拉取 server 配置失敗,等下次觸發', 'WorkCollectStore', err)
        }
    }

    /**
     * 使用者自助調整採集時間 — 寫 server(唯一真源,UpdatedBy='self'),
     * 用回傳的最新配置立即套用本地 + 重啟排程。失敗拋出讓 UI 顯示原因。
     */
    async function updateSchedule(patch: {
        intervalMinutes?: number
        workStartHour?: number
        workEndHour?: number
    }): Promise<void> {
        const userName = currentUserName()
        if (!userName) throw new Error('未登入,無法調整採集時間')
        const remote = await workCollectApi.updateMySchedule(userName, patch)
        await applyRemote(remote)
    }

    /**
     * 批次同步本地 unsynced 到 server。
     *
     * 集中化 v1.4.x:整個 50× listUnsynced/HTTP/markSynced 循環已搬到主進程
     * (electron/main/work-collect/sync-service.ts),renderer 只負責把 auth 資訊
     * 帶過去 + 觸發。token / userName / baseUrl 不寫盤,單次 invoke 在 main 結束時隨之消失。
     */
    async function syncDailyRecords(): Promise<void> {
        const userName = currentUserName()
        if (!userName) {
            // 沒工號(未登入)就別上報 —— 否則 server 端 UserId 會是空,記錄歸屬不明
            logger.warn('未登入(無工號),跳過 sync,等登入後下次觸發', 'WorkCollectStore')
            return
        }
        const token = authStore.accessToken
        if (!token) {
            logger.warn('無 access token,跳過 sync', 'WorkCollectStore')
            return
        }
        try {
            const result = await window.electronAPI.workCollect.runSync({
                userName,
                token,
                baseUrl: WORK_COLLECT_BASE_URL,
            })
            logger.info(
                `sync 完成 synced=${result.synced} failed=${result.failed} hitLimit=${result.hitLimit} ok=${result.ok}`,
                'WorkCollectStore',
            )
        } catch (err) {
            logger.warn('runSync IPC 異常', 'WorkCollectStore', err)
        }
    }

    function onSyncRequest(...args: unknown[]) {
        const payload = args[0] as { reason?: string } | undefined
        logger.debug(`收到 sync request reason=${payload?.reason ?? 'unknown'}`, 'WorkCollectStore')
        syncDailyRecords().catch((err) => logger.warn('syncDailyRecords 異常', 'WorkCollectStore', err))
    }

  /**
   * 訂閱主進程推送。冪等 —— 多次呼叫不會重複註冊(用模組級 flag 守住)。
   * App.vue mount 後呼叫一次即可。
   *
   * mode:
   *   'main'   — 主窗口模式(預設):訂閱 tick / config / sync request + 寫回 / ack,
   *              是真正驅動採集 HTTP 流程的那一份。
   *   'viewer' — LogViewer 等只「看」紀錄的視窗:只訂閱 PUSH_WORK_RECORD_NEW
   *              讓流水線自動 refresh。**不**訂 tick / config / sync,否則兩個 renderer
   *              都會打一次 analyze HTTP。也不打 notifyReady(那是給 main 補推 pending 用的)。
   *
   * Pinia store 在每個 renderer 是獨立 instance,subscribed flag 是模組級,
   * 主窗口跑 'main'、LogViewer 跑 'viewer',各自的 flag 互不影響。
   */
  function bootstrap(mode: 'main' | 'viewer' = 'main'): void {
    if (subscribed) return
    window.electronAPI.on(IpcChannels.PUSH_WORK_RECORD_NEW, onRecordNew)
      if (mode === 'main') {
          window.electronAPI.on(IpcChannels.PUSH_WORK_COLLECT_TICK, onTick)
      window.electronAPI.on(IpcChannels.PUSH_WORK_COLLECT_CONFIG_REQUEST, onConfigRequest)
      window.electronAPI.on(IpcChannels.PUSH_WORK_COLLECT_SYNC_REQUEST, onSyncRequest)
      }
    subscribed = true

      if (mode === 'main') {
      // 修正 #6:訂閱完成 ack 給 main,讓 main 補推任何 pending request,
          // 處理「main 已推但 renderer 未訂閱」的開機競態。失敗不阻塞。
      window.electronAPI.workCollect
          .notifyReady()
          .catch((err) => logger.warn('notifyReady 失敗,等下次觸發', 'WorkCollectStore', err))
      }

      // 模板 label / color 對照表:main 和 viewer 模式都要 — UI 不論在哪個窗口都該顯示
      // 中文 label + 模板配色,而非 raw code 跟 hash palette。失敗就讓兩張 map 保持空,
      // fallback 到 raw code + hash 色,UI 不會崩。不 await,bootstrap 完成優先。
      void loadCategoryMetaFromCache()
  }

    return {
        enabled, intervalMinutes, workHours, records, loading,
        categoryLabels, categoryColors, labelOf, colorOf,
        toggle, refresh, bootstrap, syncDailyRecords, updateSchedule,
    }
})

// ── 模組級狀態 ──────────────────────────────────────────────────
/**
 * 訂閱旗標。Pinia store 在 HMR 下可能 dispose + recreate,但 window.electronAPI.on 的
 * 監聽器不會跟著清,所以用模組級 flag 守住「整個 renderer 生命週期只訂一次」。
 */
let subscribed = false

/**
 * analyze 重入鎖。一次 tick 一個 HTTP,模組級才能跨 store re-instantiation 共用,
 * 不會在 HMR 重建後突然能並行(Electron 內 renderer 重啟 = 整個進程重建,自然清空)。
 */
let analyzingInflight = false

/** N 天前 00:00:00 的 Unix ms */
function startOfDaysAgo(days: number): number {
  const d = new Date()
  d.setDate(d.getDate() - days)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

