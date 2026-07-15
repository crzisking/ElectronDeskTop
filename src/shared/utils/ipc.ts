/**
 * IPC 信封拆包共用 —— 取代散在各 feature/window 自寫的 `if (r.ok) …` / `call<T>` / `unwrap<T>`。
 * 約定:成功回 data,失敗拋 Error(呼叫端自己 try/catch 決定怎麼提示)。
 */
import type {IpcResult} from '@shared/types/ipc.types'

/**
 * 拆 {ok:true,data} | {ok:false,error} —— ok 回 data(斷言為 T),否則拋 error。
 * 入參用 IpcResult<unknown>:bridge 多半回 unknown,由呼叫端 `unwrapIpc<Foo>(...)` 指定型別
 * (型別斷言集中在這一層,呼叫端不必再 `as Foo`)。
 */
export async function unwrapIpc<T = unknown>(p: Promise<IpcResult<unknown>>): Promise<T> {
    const r = await p
    if (r.ok) return r.data as T
    throw new Error(r.error)
}
