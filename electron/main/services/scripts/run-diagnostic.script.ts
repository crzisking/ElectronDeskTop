/**
 * run-diagnostic:收集系統資訊回給管理端。
 *
 * params: 無
 *
 * 不收集個人資料(沒 username/email/檔案路徑等);只給 IT 看「機器健康」的客觀指標。
 * summary 限長 4KB 內,避免 server history.Result 欄位被一筆撐爆。
 */

import {cpus, freemem, hostname, networkInterfaces, platform, release, totalmem, type} from 'os'
import {app} from 'electron'
import type {ScriptContext, ScriptResult} from '../script-runner'

export async function runDiagnosticScript(
    _params: unknown,
    ctx: ScriptContext,
): Promise<ScriptResult> {
    try {
        const cpuList = cpus()
        const info = {
            platform: platform(),
            type: type(),
            release: release(),
            hostname: hostname(),
            arch: process.arch,
            nodeVersion: process.versions.node,
            electronVersion: process.versions.electron,
            chromeVersion: process.versions.chrome,
            appVersion: app.getVersion(),
            cpuModel: cpuList[0]?.model ?? 'unknown',
            cpuCores: cpuList.length,
            memTotalGb: Math.round(totalmem() / 1024 / 1024 / 1024 * 10) / 10,
            memFreeGb: Math.round(freemem() / 1024 / 1024 / 1024 * 10) / 10,
            ips: collectIpv4(),
            uptimeSec: Math.floor(process.uptime()),
            registeredScripts: ctx.listActions(),
        }
        // JSON.stringify 後若 > 4KB 截斷給 summary,避免 SQL Server NVARCHAR(MAX) 被單筆塞太大
        let summary = JSON.stringify(info)
        if (summary.length > 4096) summary = summary.slice(0, 4096) + '...(truncated)'
        return {ok: true, summary}
    } catch (err) {
        return {ok: false, summary: `run-diagnostic 失敗: ${(err as Error).message}`}
    }
}

/** 抽所有非 loopback 的 IPv4(可能多張網卡;有線 + WiFi 都列) */
function collectIpv4(): string[] {
    const result: string[] = []
    const ifaces = networkInterfaces()
    for (const name in ifaces) {
        const list = ifaces[name]
        if (!list) continue
        for (const it of list) {
            if (it.family === 'IPv4' && !it.internal) result.push(it.address)
        }
    }
    return result
}
