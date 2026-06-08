/**
 * 工作採集 bridge。
 *
 * scheduler 推 tick → renderer 打 AI → sendResult 回 main 寫 DB。
 * 集中化 sync:main 推 sync/config request → renderer 走 HTTP → 結果 IPC 回 main。
 *
 * 結構型別只在此檔本地定義,不 import 主進程 schema,避免牽連 renderer bundle。
 * 完整型別對齊見 src/types/electron.d.ts。
 */
import type {IpcRenderer} from 'electron'

export interface WorkCollectChannelMap {
  WORK_COLLECT_TOGGLE: string
  WORK_COLLECT_LIST: string
  WORK_COLLECT_RESULT: string
    WORK_COLLECT_LIST_UNSYNCED: string
    WORK_COLLECT_MARK_SYNCED: string
    WORK_COLLECT_APPLY_REMOTE_CONFIG: string
    WORK_COLLECT_RENDERER_READY: string
    WORK_COLLECT_SYNC_DONE: string
    WORK_COLLECT_GET_TEMPLATE: string
    WORK_COLLECT_RUN_SYNC: string
}

/** sync 啟動 payload(對齊 @shared/types/work-collect.types#WorkSyncRunPayload) */
interface SyncRunPayload {
    userName: string
    token: string
    baseUrl: string
}

/** sync 結果(對齊 @shared/types/work-collect.types#WorkSyncRunResult) */
interface SyncRunResult {
    ok: boolean
    synced: number
    failed: number
    hitLimit: boolean
    error?: string
}

/**
 * 模板項目最小投影 — 只暴露 UI 顯示需要的欄位,examples / promptSnippet 等
 * 純 prompt 組裝用的細節留在主進程,renderer 拿不到、也拿不到誤用機會。
 */
interface MinimalTemplateItem {
    code: string
    label: string
    isActive: boolean
    color?: string | null
    sortOrder: number
}

interface MinimalTemplateDetail {
    templateId: number
    version: number
    name: string
    items: MinimalTemplateItem[]
}

interface MinimalWorkRecord {
    id: number
    capturedAt: number
    activeApp: string | null
    activeWindowTitle: string | null
    category: string
    description: string
    confidence: number | null
    screenshotHash: string | null
    reason: string | null
    synced: number
    syncedAt: number | null
}

/** 寫入結果(對齊主進程 OpResult) */
interface OpResult {
    ok: boolean;
    reason?: string
}

export function createWorkCollectBridge(ipc: IpcRenderer, ch: WorkCollectChannelMap) {
  return {
    toggle: (enabled: boolean) =>
      ipc.invoke(ch.WORK_COLLECT_TOGGLE, enabled) as Promise<boolean>,
    list: (params: {since: number; until: number}) =>
        ipc.invoke(ch.WORK_COLLECT_LIST, params) as Promise<MinimalWorkRecord[]>,
    sendResult: (payload: unknown) => ipc.send(ch.WORK_COLLECT_RESULT, payload),

      /** 撈未同步紀錄(synced=0) */
      listUnsynced: (limit = 200) =>
          ipc.invoke(ch.WORK_COLLECT_LIST_UNSYNCED, limit) as Promise<MinimalWorkRecord[]>,

      /** 標記已同步;回 OpResult 讓 caller 感知失敗 */
      markSynced: (localIds: number[], syncedAt: number) =>
          ipc.invoke(ch.WORK_COLLECT_MARK_SYNCED, {localIds, syncedAt}) as Promise<OpResult>,

      /** 套用 server 配置;changed=true 表示已套用 + restart scheduler */
      applyRemoteConfig: (config: {
          enabled: boolean
          intervalMinutes: number
          workStartHour: number
          workEndHour: number
          version: number
      }) =>
          ipc.invoke(ch.WORK_COLLECT_APPLY_REMOTE_CONFIG, config) as Promise<{ changed: boolean }>,

      /** bootstrap 完成 ack,main 重放 pending request */
      notifyReady: () =>
          ipc.invoke(ch.WORK_COLLECT_RENDERER_READY) as Promise<void>,

      /** sync 完成 ack,main 據此清 / 保留 pending */
      syncDone: (result: { ok: boolean; synced?: number; failed?: number; error?: string }) =>
          ipc.invoke(ch.WORK_COLLECT_SYNC_DONE, result) as Promise<void>,

      /**
       * 取本地模板 cache(沒拉到 server config / 模板被解綁時回 null)。
       * renderer 拿來建 code → label 對照,顯示分類中文名。
       */
      getTemplate: () =>
          ipc.invoke(ch.WORK_COLLECT_GET_TEMPLATE) as Promise<MinimalTemplateDetail | null>,

      /**
       * 主進程跑 sync 主流程(集中化:取代 50× IPC 來回)。
       * payload 帶 userName + token + baseUrl,token 僅活在 process 記憶體不寫盤。
       */
      runSync: (payload: SyncRunPayload) =>
          ipc.invoke(ch.WORK_COLLECT_RUN_SYNC, payload) as Promise<SyncRunResult>,
      // 注意:健康狀態(getHealth)刻意不在主窗口暴露 —— 只在密碼保護的日誌查看器
      // (log-viewer.preload)可達,避免普通使用者看到「待同步 / 失敗」維運資訊。
  }
}
