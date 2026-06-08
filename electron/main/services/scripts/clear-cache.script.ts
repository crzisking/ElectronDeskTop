/**
 * clear-cache:清除舊日誌(SQLite logs 表 + 日誌檔)。
 *
 * params: { olderThan?: number }  天數,預設 14(對齊 log-file-writer.RETENTION_DAYS)
 *
 * 不清 work_records / saved_credentials / user_profile / agent_configs 等業務資料 ——
 * 那些是使用者資產,不應該透過遠程腳本被清掉,要清也走專門接口加二次確認。
 */

import {readdirSync, statSync, unlinkSync} from 'fs'
import {join} from 'path'
import type {ScriptContext, ScriptResult} from '../script-runner'
import type {BuiltinScriptDeps} from './index'
import {getLogsDir} from '../../utils/log-file-writer'

interface ClearCacheParams {
    olderThan?: number
}

const DEFAULT_OLDER_THAN_DAYS = 14
const MIN_OLDER_THAN_DAYS = 1
const MAX_OLDER_THAN_DAYS = 365

function parseDays(p: unknown): number | string {
    if (!p || typeof p !== 'object') return DEFAULT_OLDER_THAN_DAYS
    const o = p as ClearCacheParams
    if (o.olderThan === undefined) return DEFAULT_OLDER_THAN_DAYS
    if (typeof o.olderThan !== 'number' || !Number.isFinite(o.olderThan)) {
        return 'olderThan 必須是數字(天數)'
    }
    if (o.olderThan < MIN_OLDER_THAN_DAYS || o.olderThan > MAX_OLDER_THAN_DAYS) {
        return `olderThan 必須在 ${MIN_OLDER_THAN_DAYS}-${MAX_OLDER_THAN_DAYS} 之間`
    }
    return Math.floor(o.olderThan)
}

export async function clearCacheScript(
    params: unknown,
    _ctx: ScriptContext,
    deps: BuiltinScriptDeps,
): Promise<ScriptResult> {
    const parsed = parseDays(params)
    if (typeof parsed === 'string') return {ok: false, summary: parsed}
    const days = parsed

    let dbDeleted = 0
    let fileDeleted = 0
    const errors: string[] = []

    // 1. SQLite logs 表
    if (deps.logService) {
        try {
            dbDeleted = deps.logService.cleanupOlderThan(days)
        } catch (err) {
            errors.push(`logs DB cleanup 失敗: ${(err as Error).message}`)
        }
    } else {
        errors.push('logService 未就緒,跳過 DB cleanup')
    }

    // 2. 檔案系統日誌(對應 log-file-writer 寫的 main-YYYY-MM-DD.log / renderer-YYYY-MM-DD.log)
    try {
        const logsDir = getLogsDir()
        const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
        const files = readdirSync(logsDir)
        for (const file of files) {
            if (!/^(main|renderer)-\d{4}-\d{2}-\d{2}\.log$/.test(file)) continue
            const full = join(logsDir, file)
            try {
                if (statSync(full).mtimeMs < cutoff) {
                    unlinkSync(full)
                    fileDeleted++
                }
            } catch (err) {
                errors.push(`刪 ${file} 失敗: ${(err as Error).message}`)
            }
        }
    } catch (err) {
        errors.push(`掃 logs 目錄失敗: ${(err as Error).message}`)
    }

    const summary = `dbDeleted=${dbDeleted} fileDeleted=${fileDeleted} olderThan=${days}d`
        + (errors.length > 0 ? `; errors=[${errors.join(' | ')}]` : '')
    return {ok: errors.length === 0, summary}
}
