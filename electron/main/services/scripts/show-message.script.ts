/**
 * show-message:走 Windows 系統桌面通知(Electron Notification API)。
 *
 * params 形狀:{ title: string, body: string, level?: 'info' | 'warning' | 'critical' }
 *  - title / body 必填 + 非空 + 長度 ≤ 256
 *  - level 影響 Toast 的 urgency(Linux)/silent(Windows);Windows toast 預設都會跳出
 *
 * Electron Notification 在 ready 後可用;主進程啟動完就 OK,不需要額外初始化。
 * notification.show() 是 fire-and-forget,不等使用者點選。
 */

import {app, Notification} from 'electron'
import type {ScriptContext, ScriptResult} from '../script-runner'

interface ShowMessageParams {
    title: string
    body: string
    level?: 'info' | 'warning' | 'critical'
}

function parse(p: unknown): ShowMessageParams | string {
    if (!p || typeof p !== 'object') return 'params 必須是 {title, body, level?}'
    const o = p as Partial<ShowMessageParams>
    if (typeof o.title !== 'string' || o.title.trim().length === 0) return 'title 為必填'
    if (o.title.length > 256) return 'title 長度超過 256'
    if (typeof o.body !== 'string') return 'body 為必填'
    if (o.body.length > 1024) return 'body 長度超過 1024'
    if (o.level !== undefined && !['info', 'warning', 'critical'].includes(o.level)) {
        return `level 必須是 info/warning/critical(收到: ${o.level})`
    }
    return {title: o.title.trim(), body: o.body, level: o.level}
}

export async function showMessageScript(
    params: unknown,
    _ctx: ScriptContext,
): Promise<ScriptResult> {
    const parsed = parse(params)
    if (typeof parsed === 'string') return {ok: false, summary: parsed}

    if (!Notification.isSupported()) {
        return {ok: false, summary: '當前系統不支援桌面通知'}
    }

    const notif = new Notification({
        title: parsed.title,
        body: parsed.body,
        // Windows 把 critical 對映到「跳出且不靜音」;info 走預設;warning 介於中間
        // Linux 對應 'low' / 'normal' / 'critical'
        urgency: parsed.level === 'info' ? 'low' : parsed.level === 'critical' ? 'critical' : 'normal',
        // appId 用於 Windows toast 顯示 app 名(Electron 預設 ok,留空走 process.execPath)
    })
    notif.show()

    return {
        ok: true,
        summary: `已推送 title="${parsed.title}" level=${parsed.level ?? 'info'} app=${app.getName()}`,
    }
}
