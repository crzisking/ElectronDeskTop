/**
 * collect-logs:打包近 N 天日誌成 zip,回傳檔案大小 + 路徑。
 *
 * params: { days?: number }  天數,預設 7,範圍 1-30
 *
 * 實作取捨:
 *  - Electron / Node 沒內建 zip;但本專案 desktop 不依賴額外壓縮套件
 *  - 改用「複製到一個 userData 子目錄」的取代方案,IT 端拿到路徑後可用 RDP / 共享磁碟拉
 *  - 等真需要 zip 上傳功能再加 archiver 套件
 */

import {copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync} from 'fs'
import {join} from 'path'
import {app} from 'electron'
import type {ScriptContext, ScriptResult} from '../script-runner'
import {getLogsDir} from '../../utils/log-file-writer'

interface CollectLogsParams {
    days?: number
}

const DEFAULT_DAYS = 7
const MIN_DAYS = 1
const MAX_DAYS = 30

function parseDays(p: unknown): number | string {
    if (!p || typeof p !== 'object') return DEFAULT_DAYS
    const o = p as CollectLogsParams
    if (o.days === undefined) return DEFAULT_DAYS
    if (typeof o.days !== 'number' || !Number.isFinite(o.days)) return 'days 必須是數字'
    if (o.days < MIN_DAYS || o.days > MAX_DAYS) return `days 必須在 ${MIN_DAYS}-${MAX_DAYS}`
    return Math.floor(o.days)
}

export async function collectLogsScript(
    params: unknown,
    _ctx: ScriptContext,
): Promise<ScriptResult> {
    const parsed = parseDays(params)
    if (typeof parsed === 'string') return {ok: false, summary: parsed}
    const days = parsed

    try {
        const srcDir = getLogsDir()
        // 輸出到 <userData>/collected-logs/<timestamp>/,IT 端撈走
        const outRoot = join(app.getPath('userData'), 'collected-logs')
        const stamp = new Date().toISOString().replace(/[:.]/g, '-')
        const outDir = join(outRoot, stamp)
        mkdirSync(outDir, {recursive: true})

        const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
        const files = existsSync(srcDir) ? readdirSync(srcDir) : []
        let copied = 0
        let bytes = 0
        for (const file of files) {
            if (!/^(main|renderer)-\d{4}-\d{2}-\d{2}\.log$/.test(file)) continue
            const full = join(srcDir, file)
            const stat = statSync(full)
            if (stat.mtimeMs < cutoff) continue
            copyFileSync(full, join(outDir, file))
            copied++
            bytes += stat.size
        }

        // 順手清掉 60 天前的舊收集目錄(避免無限增長);60 天足夠 IT 拉走
        try {
            const olderCutoff = Date.now() - 60 * 24 * 60 * 60 * 1000
            for (const sub of readdirSync(outRoot)) {
                const subPath = join(outRoot, sub)
                try {
                    if (statSync(subPath).mtimeMs < olderCutoff) {
                        rmSync(subPath, {recursive: true, force: true})
                    }
                } catch {
                    // 忽略單一刪除失敗
                }
            }
        } catch {
            // 清理失敗不影響本次任務
        }

        return {
            ok: true,
            summary: `collected ${copied} files (${formatBytes(bytes)}) days=${days} → ${outDir}`,
        }
    } catch (err) {
        return {ok: false, summary: `collect-logs 失敗: ${(err as Error).message}`}
    }
}

function formatBytes(n: number): string {
    if (n < 1024) return `${n}B`
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`
    return `${(n / 1024 / 1024).toFixed(2)}MB`
}
