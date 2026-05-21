/**
 * 工作自動採集 — 渲染端 API 薄包裝。
 *
 * 全部走 IPC,不直接打網路:
 *  - 採集是主進程 setInterval 自己跑的,渲染端只看結果
 *  - toggle 開關透過 IPC 切換,主進程同步寫 config 並啟停 scheduler
 *  - list 查本機 SQLite,主進程 service 處理
 *
 * 後端 API URL 由本模組讀 VITE_REPAIR_API_URL 帶給主進程(主進程沒 import.meta.env)。
 */

import type {WorkRecord} from '@/types/work-record.types'

/** 後端 API base URL,跟 repair 同 host(都是 tmbom 後端) */
const API_BASE_URL: string =
  (import.meta.env.VITE_REPAIR_API_URL as string | undefined) ?? 'http://localhost:5247'

export const workCollectApi = {
  /**
   * 登入成功 / token 更新時呼叫一次。把 JWT + API base 推給主進程 scheduler。
   * token 為 null 表示登出,主進程之後 tick 會 skip(不會打不帶 token 的請求)。
   */
  syncAuth(token: string | null): void {
    window.electronAPI.workCollect.setAuth({token, apiBaseUrl: API_BASE_URL})
  },

  /**
   * 切換採集開關。主進程會寫進 app-config.json 並啟停 scheduler。
   * @returns 切換後的狀態(成功時跟入參一致)
   */
  toggle(enabled: boolean): Promise<boolean> {
    return window.electronAPI.workCollect.toggle(enabled)
  },

  /**
   * 查詢某時間區間內的紀錄,給流水線 UI 用。
   * @param since 起始時間,Unix ms,inclusive
   * @param until 結束時間,Unix ms,exclusive
   */
  list(since: number, until: number): Promise<WorkRecord[]> {
    return window.electronAPI.workCollect.list({since, until})
  },
}
