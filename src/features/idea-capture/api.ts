/**
 * 靈感速記想法庫 API(主窗)。
 * 薄封裝 window.electronAPI.ideaCapture,拆 {ok,data}|{ok,error} envelope 成「回 data / 拋 error」。
 */
import type {IdeaPaged} from '@/types/electron/idea-capture'
import type {IdeaDetail, IdeaListItem, IdeaListQuery, IdeaPatch,} from '@shared/types/idea-capture.types'

type Result<T> = { ok: true; data: T } | { ok: false; error: string }

async function unwrap<T>(p: Promise<Result<T>>): Promise<T> {
    const r = await p
    if (r.ok) return r.data
    throw new Error(r.error)
}

const api = () => window.electronAPI.ideaCapture

export const ideaLibraryApi = {
    listMy: (query: IdeaListQuery) => unwrap<IdeaPaged<IdeaListItem>>(api().listMy(query)),
    listDept: (query: IdeaListQuery) => unwrap<IdeaPaged<IdeaListItem>>(api().listDept(query)),
    detail: (clientId: string) => unwrap<IdeaDetail>(api().detail(clientId)),
    patch: (clientId: string, patch: IdeaPatch) => unwrap<boolean>(api().patch(clientId, patch)),
    remove: (clientId: string) => unwrap<boolean>(api().remove(clientId)),
    getAttachment: (url: string) => unwrap<string>(api().getAttachment(url)),
    refine: (clientId: string) => unwrap<boolean>(api().refine(clientId)),
}
