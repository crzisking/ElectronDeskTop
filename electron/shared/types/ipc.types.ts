/**
 * IPC 通用信封型別 — preload bridge / renderer typing 共用,
 * 取代曾散落在 3+ 個檔案的同構定義。
 * 只含型別(編譯期擦除),sandbox preload 也能安全 import type。
 */

/** 呼叫後端必備上下文:baseUrl + 工號(userId);token 預留 */
export interface IpcCtx {
    baseUrl: string
    userId: string
    token?: string
}

export type IpcOk<T> = { ok: true; data: T }
export type IpcErr = { ok: false; error: string }

/** 所有 invoke 的統一返回信封(對齊 main 端 safeRun 包裝) */
export type IpcResult<T> = IpcOk<T> | IpcErr
