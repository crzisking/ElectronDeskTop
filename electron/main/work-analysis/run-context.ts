/**
 * 工作分析 stream run context — 管理「正在跑的 stream」狀態。
 *
 * 設計:
 *   同時間只允許**一個** active run(避免 LLM 配額被多 tab 並發吃光,也讓 UX 清楚:
 *   一個 dialog 只跟一個 run 對應)。新 run 來時若已有 active → 直接 reject。
 *   要強制換,先呼 interrupt 釋放。
 *
 * 為何不放任意 N 個 run:
 *   - 工作分析是「使用者主動觸發 + 等結果」場景,沒有並行需求
 *   - N 個 run 需要 per-run 的 push channel 路由,複雜度高
 *   - 預算 5 次/天本來就不該並發消耗
 */

import {randomUUID} from 'crypto'

export interface RunHandle {
    runId: string
    abort: AbortController
    rangeStart: number
    rangeEnd: number
    /** 起跑時間 ms,供 stats / timeout 兜底用 */
    startedAt: number
}

class RunContext {
    private current: RunHandle | null = null

    /**
     * 嘗試起新 run。
     * @returns 成功 → RunHandle;失敗(已有 active) → null
     */
    tryStart(rangeStart: number, rangeEnd: number): RunHandle | null {
        if (this.current) return null
        const handle: RunHandle = {
            runId: randomUUID(),
            abort: new AbortController(),
            rangeStart,
            rangeEnd,
            startedAt: Date.now(),
        }
        this.current = handle
        return handle
    }

    /** 取得當前 run(若 runId 不符回 null) */
    get(runId: string): RunHandle | null {
        return this.current?.runId === runId ? this.current : null
    }

    /** run 結束(成功 / 失敗 / 中止)— 都呼這個釋放 slot */
    end(runId: string): void {
        if (this.current?.runId === runId) this.current = null
    }

    /**
     * 中止指定 run。
     * @returns true 找到並中止;false 無此 run
     */
    interrupt(runId: string): boolean {
        if (this.current?.runId !== runId) return false
        this.current.abort.abort()
        return true
    }

    /** 目前有沒有 active(給 UI 查) */
    hasActive(): boolean {
        return this.current !== null
    }
}

export const workAnalysisRunContext = new RunContext()
