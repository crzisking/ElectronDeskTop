/**
 * project-flow Pinia store — 跨頁面共享狀態。
 *
 * 職責:
 *  - 訂閱 PUSH_PROJECT_FLOW_EVENT(由 main 進程從 SignalR 轉發過來),
 *    根據 action invalidate 對應集合
 *  - 集中 list/refresh,避免每個 View 各自打 IPC
 *  - 提供 dispose() 撤銷監聽,App 退出 / HMR 熱更時呼叫
 */

import {defineStore} from 'pinia'
import {computed, ref, watch} from 'vue'
import {IpcChannels} from '@shared/ipc-channels'
import {logger} from '@/shared/utils/logger'
import {useAuthStore} from '@/stores/auth.store'
import {projectFlowApi} from './api'
import type {
    AiQuotaInfo,
    FeedbackResponse,
    MemoResponse,
    PagedResult,
    ProjectFlowPushEvent,
    ProjectListItem,
    ReportSummaryItem,
} from './types'

const TAG = 'projectFlow.store'

/**
 * 統一 loadX 模板:呼叫 paged API → 取 .list → 賦值給 target ref。
 * 後端 PagedResult<T>.List 欄位是 list(對齊 PagedResult.cs)。
 */
async function loadPaged<T>(
    fetch: () => Promise<PagedResult<T[]> | unknown>,
    target: { value: T[] },
    label: string,
) {
    try {
        const res = (await fetch()) as PagedResult<T[]> | undefined
        target.value = res?.list ?? []
    } catch (err) {
        logger.warn(`${label} 失敗: ${(err as Error).message}`, TAG)
    }
}

export const useProjectFlowStore = defineStore('projectFlow', () => {
    // ── State ──
    const projects = ref<ProjectListItem[]>([])
    const reports = ref<ReportSummaryItem[]>([])
    const memos = ref<MemoResponse[]>([])
    const unreadFeedbacks = ref<FeedbackResponse[]>([])
    const unreadCount = ref(0)
    const quota = ref<AiQuotaInfo | null>(null)
    const loading = ref(false)

    // 命名 callback;Proxy 註冊到 listenerMap 後才能正確 off()(對齊 preload/index.ts WeakMap 機制)
    let pushHandler: ((...args: unknown[]) => void) | null = null
    let bootstrapped = false

    // ── Getters ──
    const hasUnread = computed(() => unreadCount.value > 0)

    // ── Actions ──
    async function loadProjects() {
        loading.value = true
        await loadPaged(() => projectFlowApi.listProjects({page: 1, pageSize: 50}), projects, 'loadProjects')
        loading.value = false
    }

    const loadReports = () =>
        loadPaged(() => projectFlowApi.listReports({page: 1, pageSize: 50}), reports, 'loadReports')

    const loadMemos = () =>
        loadPaged(() => projectFlowApi.listMemos({page: 1, pageSize: 50}), memos, 'loadMemos')

    async function refreshUnread() {
        try {
            const r = (await projectFlowApi.countMyUnread()) as { count: number }
            unreadCount.value = r?.count ?? 0
            if (unreadCount.value > 0) {
                // listMyUnread 端點返回 {items, count}(非 PagedResult),不可走 loadPaged
                const list = (await projectFlowApi.listMyUnread()) as { items: FeedbackResponse[] }
                unreadFeedbacks.value = list?.items ?? []
            } else {
                unreadFeedbacks.value = []
            }
        } catch (err) {
            logger.warn(`refreshUnread 失敗: ${(err as Error).message}`, TAG)
        }
    }

    async function refreshQuota() {
        try {
            quota.value = (await projectFlowApi.getQuota()) as AiQuotaInfo
        } catch (err) {
            logger.warn(`refreshQuota 失敗: ${(err as Error).message}`, TAG)
        }
    }

    /** 收到 main 轉發的 SignalR action 後 invalidate + refetch,保證多端排序一致 */
    function onPushEvent(evt: ProjectFlowPushEvent) {
        logger.info(`收到 project-flow push: ${evt.action}`, TAG)
        switch (evt.action) {
            case 'project-flow.feedback-new':
                refreshUnread()
                break
            case 'project-flow.report-submitted':
                loadReports()
                break
            // 未知 action 不主動 refetch
        }
    }

    function bootstrap() {
        if (bootstrapped) return
        bootstrapped = true
        // 命名 callback 存在 module-level,確保 dispose() 能用同一 ref 撤銷
        pushHandler = (...args: unknown[]) => {
            const evt = args[0] as ProjectFlowPushEvent
            if (evt && typeof evt.action === 'string') onPushEvent(evt)
        }
        window.electronAPI.on(IpcChannels.PUSH_PROJECT_FLOW_EVENT, pushHandler)

        // 登入後才有 userId,IPC handler 拿 ctx 才不會 missing ctx;
        // App.vue mount 階段 bootstrap 時,使用者可能還沒登入,直接 fetch 會 warn 一堆。
        // 用 watch 監聽 isAuthenticated:已登入立即 fetch,未登入則等變 true 後第一次觸發。
        const auth = useAuthStore()
        watch(
            () => auth.isAuthenticated,
            (yes) => {
                if (yes) {
                    refreshUnread()
                    refreshQuota()
                }
            },
            {immediate: true},
        )
    }

    /** 應用退出 / HMR 重載時呼叫,撤銷 IPC 監聽避免重複註冊 */
    function dispose() {
        if (pushHandler) {
            window.electronAPI.off(IpcChannels.PUSH_PROJECT_FLOW_EVENT, pushHandler)
            pushHandler = null
        }
        bootstrapped = false
    }

    return {
        projects, reports, memos, unreadFeedbacks, unreadCount, quota, loading,
        hasUnread,
        loadProjects, loadReports, loadMemos, refreshUnread, refreshQuota,
        bootstrap, dispose,
    }
})
