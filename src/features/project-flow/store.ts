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
    FeedbackResponse,
    MemoResponse,
    PagedResult,
    ProjectFlowPushEvent,
    ProjectListItem,
    ReportSummaryItem,
} from './types'

const TAG = 'projectFlow.store'

/** 列表統一頁大小 */
export const PF_PAGE_SIZE = 20

/**
 * 統一 loadX 模板:呼叫 paged API → list 進 target、total 進 totalRef。
 * 後端 PagedResult<T> 欄位是 list / total(對齊 PagedResult.cs)。
 * 失敗時把錯誤訊息留在 lastError(備忘獨立窗用它判斷「未登入」狀態)。
 */
async function loadPaged<T>(
    fetch: () => Promise<PagedResult<T[]> | unknown>,
    target: { value: T[] },
    totalRef: { value: number },
    errorRef: { value: string | null },
    label: string,
) {
    try {
        const res = (await fetch()) as PagedResult<T[]> | undefined
        target.value = res?.list ?? []
        totalRef.value = res?.total ?? 0
        errorRef.value = null
    } catch (err) {
        errorRef.value = (err as Error).message
        logger.warn(`${label} 失敗: ${(err as Error).message}`, TAG)
    }
}

export const useProjectFlowStore = defineStore('projectFlow', () => {
    // ── State ──
    const projects = ref<ProjectListItem[]>([])
    const projectsTotal = ref(0)
    const reports = ref<ReportSummaryItem[]>([])
    const reportsTotal = ref(0)
    const memos = ref<MemoResponse[]>([])
    const memosTotal = ref(0)
    const unreadFeedbacks = ref<FeedbackResponse[]>([])
    const unreadCount = ref(0)
    const loading = ref(false)
    /** 最後一次列表載入的錯誤(null=正常);備忘獨立窗用 'missing ctx' 判斷未登入 */
    const lastError = ref<string | null>(null)

    // 命名 callback;Proxy 註冊到 listenerMap 後才能正確 off()(對齊 preload/index.ts WeakMap 機制)
    let pushHandler: ((...args: unknown[]) => void) | null = null
    let bootstrapped = false

    // ── Getters ──
    const hasUnread = computed(() => unreadCount.value > 0)

    // ── Actions ──
    // ⚠️ 後端分頁參數名是 pageIndex(PagedQuery.cs),不是 page — 傳錯會被無聲忽略
    async function loadProjects(pageIndex = 1) {
        loading.value = true
        await loadPaged(
            () => projectFlowApi.listProjects({pageIndex, pageSize: PF_PAGE_SIZE}),
            projects, projectsTotal, lastError, 'loadProjects')
        loading.value = false
    }

    const loadReports = (pageIndex = 1) =>
        loadPaged(
            () => projectFlowApi.listReports({pageIndex, pageSize: PF_PAGE_SIZE}),
            reports, reportsTotal, lastError, 'loadReports')

    const loadMemos = (pageIndex = 1) =>
        loadPaged(
            () => projectFlowApi.listMemos({pageIndex, pageSize: PF_PAGE_SIZE}),
            memos, memosTotal, lastError, 'loadMemos')

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
                if (yes) refreshUnread()
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
        projects, projectsTotal, reports, reportsTotal, memos, memosTotal,
        unreadFeedbacks, unreadCount, loading, lastError,
        hasUnread,
        loadProjects, loadReports, loadMemos, refreshUnread,
        bootstrap, dispose,
    }
})
