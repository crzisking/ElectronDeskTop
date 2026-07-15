/**
 * project-flow Pinia store — 備忘錄列表狀態(給備忘錄獨立窗用)。
 *
 * ⚠️ 專案/匯報/反饋/團隊功能已清退,原本的 SignalR push 訂閱(feedback-new 等)
 * 隨反饋一起移除;bootstrap/dispose 生命週期不再需要。
 */

import {defineStore} from 'pinia'
import {ref} from 'vue'
import {logger} from '@/shared/utils/logger'
import {projectFlowApi} from './api'
import type {MemoResponse, PagedResult} from './types'

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
    const memos = ref<MemoResponse[]>([])
    const memosTotal = ref(0)
    const loading = ref(false)
    /** 最後一次列表載入的錯誤(null=正常);備忘獨立窗用它判斷未登入 */
    const lastError = ref<string | null>(null)

    const loadMemos = (pageIndex = 1) =>
        loadPaged(
            () => projectFlowApi.listMemos({pageIndex, pageSize: PF_PAGE_SIZE}),
            memos, memosTotal, lastError, 'loadMemos')

    return {memos, memosTotal, loading, lastError, loadMemos}
})
