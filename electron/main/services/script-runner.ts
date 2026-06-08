/**
 * ScriptRunner — 內建腳本註冊 + 派發器。
 *
 * 設計對齊 docs/18-遠程通知與內置腳本執行設計.md:
 *   - server 推 type=task,action=<scriptName>,params 透傳
 *   - runner 從註冊表找到對應 ScriptHandler,執行後回 {ok, summary}
 *   - 未知 action / params 校驗失敗 → 返回 ok=false,不擴散異常
 *
 * 安全:
 *   只執行**程式碼內已註冊**的腳本(register() 一次),server 端推任意 action 名都會被拒。
 *   參數校驗在每個 script 內自己做。
 */

import {logger} from '../utils/logger'

const TAG = 'ScriptRunner'

export interface ScriptContext {
    /** 取目前 ScriptRunner 註冊表的所有 action(供 run-diagnostic 等元腳本用) */
    listActions(): string[]
}

export interface ScriptResult {
    ok: boolean
    summary: string
}

/** 每個腳本實作此 type:input 是 server 透傳的 params(可能任何形狀)*/
export type ScriptHandler = (params: unknown, ctx: ScriptContext) => Promise<ScriptResult>

export class ScriptRunner implements ScriptContext {
    private readonly handlers = new Map<string, ScriptHandler>()

    /** 註冊一個腳本;重複 action 名後者覆蓋(便於 HMR / 替換) */
    register(action: string, handler: ScriptHandler): void {
        this.handlers.set(action, handler)
        logger.debug(`註冊腳本 action=${action}`, TAG)
    }

    listActions(): string[] {
        return [...this.handlers.keys()]
    }

    /** server 推下來的任務 — 找對應 handler 執行;任何錯誤都吞進 result.summary */
    async execute(action: string, params: unknown): Promise<ScriptResult> {
        const handler = this.handlers.get(action)
        if (!handler) {
            const summary = `unknown action: ${action}`
            logger.warn(summary, TAG)
            return {ok: false, summary}
        }
        try {
            const result = await handler(params, this)
            logger.info(`script ${action} 完成 ok=${result.ok} summary=${result.summary.slice(0, 200)}`, TAG)
            return result
        } catch (err) {
            const summary = err instanceof Error ? err.message : String(err)
            logger.warn(`script ${action} 拋例外: ${summary}`, TAG)
            return {ok: false, summary}
        }
    }
}
