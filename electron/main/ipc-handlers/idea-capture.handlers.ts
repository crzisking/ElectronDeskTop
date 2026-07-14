/**
 * 靈感速記 IPC handlers(docs/21)。薄轉發層:業務在 idea-capture/api-client + refiner。
 * 統一回 {ok:true,data} | {ok:false,error}。身分從 authContext 取(主窗登入後推進來)。
 */

import {ipcMain} from 'electron'
import {IpcChannels} from '../../shared/ipc-channels'
import {authContext} from '../services/auth-context'
import {ideaApi, type IdeaApiContext} from '../idea-capture/api-client'
import type {IdeaConfigStore} from '../idea-capture/config-store'
import type {IdeaRefiner} from '../idea-capture/refiner'
import type {IdeaHotkeyManager} from '../idea-capture/hotkey-manager'
import type {IdeaCaptureWindow} from '../windows/idea-capture-window'
import type {
    IdeaCreateMeta,
    IdeaDraftAttachment,
    IdeaListQuery,
    IdeaPatch,
} from '../../shared/types/idea-capture.types'

export interface IdeaCaptureHandlerDeps {
    configStore: IdeaConfigStore | null
    refiner: IdeaRefiner | null
    hotkey: IdeaHotkeyManager | null
    captureWindow: IdeaCaptureWindow | null
}

type Result<T> = { ok: true; data: T } | { ok: false; error: string }

async function safe<T>(fn: () => T | Promise<T>): Promise<Result<T>> {
    try {
        return {ok: true, data: await fn()}
    } catch (err) {
        return {ok: false, error: err instanceof Error ? err.message : String(err)}
    }
}

/** 取後端呼叫上下文;未登入回 null */
function ctx(): IdeaApiContext | null {
    const a = authContext.get()
    if (!a.userId) return null
    return {baseUrl: a.baseUrl, userName: a.userId, token: a.token}
}

export function registerIdeaCaptureHandlers(deps: IdeaCaptureHandlerDeps): void {
    const ch = IpcChannels
    const noAuth = {ok: false as const, error: '尚未登入,請先登入主視窗'}

    // ── 建立 ──
    ipcMain.handle(ch.IDEA_CREATE, async (_e, p: { meta?: IdeaCreateMeta; files?: IdeaDraftAttachment[] }) => {
        const c = ctx()
        if (!c) return noAuth
        if (!p?.meta) return {ok: false, error: 'meta 為必填'}
        return safe(async () => {
            const res = await ideaApi.create(c, p.meta!, p.files ?? [])
            // wantAI → 丟進後台完善佇列(不阻塞;稍後 push 刷新)
            if (p.meta!.wantAI && deps.refiner) deps.refiner.enqueue(res.clientId)
            return res
        })
    })

    // ── 列表 / 詳情 ──
    ipcMain.handle(ch.IDEA_LIST_MY, (_e, p: { query?: IdeaListQuery }) => {
        const c = ctx()
        if (!c) return noAuth
        return safe(() => ideaApi.listMy(c, p?.query ?? {}))
    })

    ipcMain.handle(ch.IDEA_LIST_DEPT, (_e, p: { query?: IdeaListQuery }) => {
        const c = ctx()
        if (!c) return noAuth
        return safe(() => ideaApi.listDept(c, p?.query ?? {}))
    })

    ipcMain.handle(ch.IDEA_DETAIL, (_e, p: { clientId?: string }) => {
        const c = ctx()
        if (!c) return noAuth
        if (!p?.clientId) return {ok: false, error: '缺 clientId'}
        return safe(() => ideaApi.detail(c, p.clientId!))
    })

    // ── 修改 / 刪除 ──
    ipcMain.handle(ch.IDEA_PATCH, (_e, p: { clientId?: string; patch?: IdeaPatch }) => {
        const c = ctx()
        if (!c) return noAuth
        if (!p?.clientId) return {ok: false, error: '缺 clientId'}
        return safe(() => ideaApi.patch(c, p.clientId!, p.patch ?? {}))
    })

    ipcMain.handle(ch.IDEA_DELETE, (_e, p: { clientId?: string }) => {
        const c = ctx()
        if (!c) return noAuth
        if (!p?.clientId) return {ok: false, error: '缺 clientId'}
        return safe(() => ideaApi.delete(c, p.clientId!))
    })

    // ── 附件(MinIO URL 代拉成 dataURL) ──
    ipcMain.handle(ch.IDEA_GET_ATTACHMENT, (_e, p: { url?: string }) => {
        if (!p?.url) return {ok: false, error: '缺 url'}
        return safe(() => ideaApi.fetchAttachment(p.url!))
    })

    // ── 手動補觸發 / 重試後台完善 ──
    ipcMain.handle(ch.IDEA_REFINE, (_e, p: { clientId?: string }) => {
        if (!deps.refiner) return {ok: false, error: '完善服務未就緒'}
        if (!p?.clientId) return {ok: false, error: '缺 clientId'}
        deps.refiner.enqueue(p.clientId)
        return {ok: true, data: true}
    })

    // ── 速記小窗:取上下文 / 隱藏自己 ──
    ipcMain.handle(ch.IDEA_GET_CONTEXT, () => {
        const activeWindow = deps.hotkey?.takePendingContext().activeWindow ?? ''
        return {ok: true, data: {activeWindow}}
    })

    ipcMain.handle(ch.IDEA_HIDE_CAPTURE, () => {
        deps.captureWindow?.hide()
        return {ok: true, data: true}
    })

    // ── 配置(熱鍵) ──
    ipcMain.handle(ch.IDEA_CONFIG_READ, () => {
        if (!deps.configStore) return {ok: false, error: 'DB 未就緒'}
        return {ok: true, data: deps.configStore.read()}
    })

    ipcMain.handle(ch.IDEA_CONFIG_WRITE, (_e, p: { partial?: Record<string, unknown> }) => {
        if (!deps.configStore) return {ok: false, error: 'DB 未就緒'}
        const ok = deps.configStore.write((p?.partial ?? {}) as never)
        // 熱鍵可能改了 → 重新註冊
        if (ok) deps.hotkey?.register()
        return {ok: true, data: ok}
    })
}
