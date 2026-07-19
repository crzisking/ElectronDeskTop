/**
 * IPC handler 統一回應信封 helper —— 取代散在各 handler 的同構 `ok`/`fail`/`safeRun`/`safe`。
 * 型別單源自 `@shared/types/ipc.types`(IpcResult)。走 `{ok:true,data}|{ok:false,error}` 的 handler
 * 都應復用這裡;裸值 handler(config/work-collect/auth 等歷史約定)不強制。
 */
import type {IpcResult} from '../../shared/types/ipc.types'

export const ok = <T>(data: T): IpcResult<T> => ({ok: true, data})
export const fail = (error: string): IpcResult<never> => ({ok: false, error})

/** 包一層 try/catch:回值轉 {ok:true,data},異常轉 {ok:false,error}。handler 不用各自寫。 */
export async function safeRun<T>(fn: () => T | Promise<T>): Promise<IpcResult<T>> {
    try {
        return {ok: true, data: await fn()}
    } catch (err) {
        return {ok: false, error: err instanceof Error ? err.message : String(err)}
    }
}
