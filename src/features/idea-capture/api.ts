/**
 * 靈感速記想法庫 API(主窗,渲染端直連後端)。
 *
 * 讀取 / 快速修改(list / detail / patch / delete)走渲染端 axios 直打後端 —— 跟 repair 一致,
 * 走 auth 攔截器(注入 token + 統一錯誤),DevTools 網路面板看得到。
 * ⚠️ 例外:AI 完善(refine)是 30~60s 的長任務,仍走主進程背景佇列(非阻塞 + 完成後 push 刷新),
 *    這裡只轉發 IPC;速記小窗(獨立窗、CSP 鎖死、無 authStore)也照舊走主進程,不在本檔。
 *
 * userName(工號)由 authStore 帶上;後端 IdeaCaptureController 是 [AllowAnonymous] + 顯式 userName。
 */
import {httpClientFor} from '@/api/http-client'
import {BACKEND_BASE_URL} from '@/shared/config/backend'
import {unwrapIpc} from '@/shared/utils/ipc'
import {useAuthStore} from '@/stores/auth.store'
import type {IdeaDetail, IdeaListItem, IdeaListQuery, IdeaPatch} from '@shared/types/idea-capture.types'
import type {IdeaPaged} from '@/types/electron/idea-capture'

const client = () => httpClientFor(BACKEND_BASE_URL, 20000)

/** 當前工號(後端認身分用) */
const uname = () => useAuthStore().userName

export const ideaLibraryApi = {
    listMy(query: IdeaListQuery): Promise<IdeaPaged<IdeaListItem>> {
        return client().get('/api/IdeaCapture/my', {params: {...query, userName: uname()}})
    },

    listDept(query: IdeaListQuery): Promise<IdeaPaged<IdeaListItem>> {
        return client().get('/api/IdeaCapture/dept', {params: {...query, userName: uname()}})
    },

    detail(clientId: string): Promise<IdeaDetail> {
        return client().get(`/api/IdeaCapture/detail/${encodeURIComponent(clientId)}`, {params: {userName: uname()}})
    },

    patch(clientId: string, patch: IdeaPatch): Promise<boolean> {
        return client().patch(`/api/IdeaCapture/${encodeURIComponent(clientId)}`, {...patch, userName: uname()})
    },

    remove(clientId: string): Promise<boolean> {
        return client().delete(`/api/IdeaCapture/${encodeURIComponent(clientId)}`, {params: {userName: uname()}})
    },

    /**
     * 觸發 AI 完善。長任務 → 走主進程背景佇列(立即返回,完成後 push IDEA_PUSH_REFINED 刷新列表),
     * 不在渲染端同步等 30~60s。這裡轉發 IPC 並拆 envelope。
     */
    async refine(clientId: string): Promise<void> {
        await unwrapIpc(window.electronAPI.ideaCapture.refine(clientId))
    },
}
