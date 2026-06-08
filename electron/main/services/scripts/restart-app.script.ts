/**
 * restart-app:倒數彈窗給使用者取消,超時後 app.relaunch + app.quit。
 *
 * params: { delayMs?: number }  倒數時間,預設 10000(10 秒)
 *
 * 設計取捨(對齊用戶決策「倒數彈窗給使用者取消」):
 *  - 用 dialog.showMessageBox 但加 setTimeout 自動 close 達成倒數
 *  - dialog 預設 cancelId 對映到取消按鈕,Promise resolve 後判斷 response
 *  - 如果主窗口未開(背景跑),仍能彈出 — dialog.showMessageBox(null) 走系統級對話框
 *
 * 失敗策略:任何步驟拋例外 → 不重啟 → 返回 ok=false。**寧可不重啟也不要 silent restart**。
 */

import {app, BrowserWindow, dialog} from 'electron'
import type {ScriptContext, ScriptResult} from '../script-runner'
import type {BuiltinScriptDeps} from './index'

interface RestartParams {
    delayMs?: number
}

const DEFAULT_DELAY_MS = 10_000
const MIN_DELAY_MS = 3_000
const MAX_DELAY_MS = 60_000

function parse(p: unknown): number | string {
    if (!p || typeof p !== 'object') return DEFAULT_DELAY_MS
    const o = p as RestartParams
    if (o.delayMs === undefined) return DEFAULT_DELAY_MS
    if (typeof o.delayMs !== 'number' || !Number.isFinite(o.delayMs)) {
        return 'delayMs 必須是數字(毫秒)'
    }
    if (o.delayMs < MIN_DELAY_MS || o.delayMs > MAX_DELAY_MS) {
        return `delayMs 必須在 ${MIN_DELAY_MS}-${MAX_DELAY_MS} 之間`
    }
    return Math.floor(o.delayMs)
}

export async function restartAppScript(
    params: unknown,
    _ctx: ScriptContext,
    deps: BuiltinScriptDeps,
): Promise<ScriptResult> {
    const parsed = parse(params)
    if (typeof parsed === 'string') return {ok: false, summary: parsed}
    const delayMs = parsed
    const seconds = Math.ceil(delayMs / 1000)

    // 把 dialog 掛在主窗(若有)上;沒有就走系統級
    const parent = deps.windowManager
        ? BrowserWindow.getAllWindows().find((w) => !w.isDestroyed()) ?? null
        : null

    // dialog.showMessageBox 是 await 等使用者點;為了實作倒數,加 setTimeout 自己 close
    // Electron 沒有「強制關 dialog」的 API,改用 Promise.race:倒數 timer 跟 dialog 比賽
    const userChoice = await new Promise<'restart' | 'cancel'>((resolve) => {
        const opts: Electron.MessageBoxOptions = {
            type: 'warning',
            title: 'IT 要求重啟應用',
            message: 'IT 系統管理員要求重啟此應用',
            detail: `將在 ${seconds} 秒後自動重啟,點「取消」可推遲。重啟過程約 5 秒,請先儲存手邊工作。`,
            buttons: ['立刻重啟', '取消'],
            defaultId: 0,
            cancelId: 1,
        }
        const dialogPromise = parent ? dialog.showMessageBox(parent, opts) : dialog.showMessageBox(opts)
        let settled = false

        const timer = setTimeout(() => {
            if (settled) return
            settled = true
            // 超時 → 視為使用者沒拒絕,執行重啟。dialog 本身留著沒關沒關係,relaunch 會把整個 app 收掉
            resolve('restart')
        }, delayMs)

        dialogPromise.then((res) => {
            if (settled) return
            settled = true
            clearTimeout(timer)
            // response=0 立刻重啟;response=1 取消
            resolve(res.response === 1 ? 'cancel' : 'restart')
        }).catch(() => {
            // dialog 拋例外(極端少見)→ 視為取消,別在 IT 不知情下重啟
            if (settled) return
            settled = true
            clearTimeout(timer)
            resolve('cancel')
        })
    })

    if (userChoice === 'cancel') {
        return {ok: true, summary: `使用者取消重啟(等待 ${seconds}s 內按取消)`}
    }

    // 走重啟流程:relaunch 排隊新進程,quit 收當前進程
    try {
        app.relaunch()
        // 給 quit 一點時間讓 IPC 回傳 result 上去
        setTimeout(() => app.quit(), 200)
    } catch (err) {
        return {ok: false, summary: `relaunch/quit 拋例外: ${(err as Error).message}`}
    }
    return {ok: true, summary: `已觸發重啟(延遲 ${seconds}s 後使用者未取消)`}
}
