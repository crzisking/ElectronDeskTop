/**
 * 工作採集相關型別:跨 main / renderer 邊界。
 *
 *  - WorkCategory / WorkRecord:從主進程 schema re-export(只 import type,不會把 schema 程式碼帶進 renderer)
 *  - WorkCollectTickPayload:main → renderer 推送的「採集 tick」資料
 *  - WorkResultPayload     :renderer → main 回送的「AI 分析結果」資料
 *  - WorkAnalyzeResponse   :後端 /api/WorkCollect/analyze 的 .data 部分
 */

// 跨進程 type-only import:relative path 跨 src/ → electron/main/。
// 只引型別,vite 不會把主進程代碼打進 renderer bundle。
import type {NewWorkRecord, WorkCategory, WorkRecord} from '../../../electron/main/db/features'

export type {WorkCategory, WorkRecord, NewWorkRecord}

/** main → renderer:採集 tick payload */
export interface WorkCollectTickPayload {
  jpeg: Uint8Array
  activeWindow: string
  appName: string
  allWindows: string[]
  capturedAt: number
  /** 主進程算好的截圖 dHash(16 hex),renderer 拿到不處理,直接帶回 main 寫 DB */
  screenshotHash: string
}

/** renderer → main:AI 結果回送 */
export interface WorkResultPayload {
  capturedAt: number
  activeApp: string | null
  activeWindowTitle: string | null
  category: WorkCategory
  description: string
  confidence: number
  /** dHash,from tick payload 透傳 */
  screenshotHash: string | null
  /** AI 分類理由,可空 */
  reason: string | null
}

/** 後端 unified response 的 .data */
export interface WorkAnalyzeResponse {
  category: WorkCategory
  description: string
  reason: string
  confidence: number
}

/**
 * 集中化(docs/20):後端 /api/WorkCollect/my-config 的 .data
 * desktop 啟動 + 每天首次 tick 進工時前拉一次,版本變了就覆蓋本地 config。
 */
export interface WorkConfigResponse {
  userId: string
  enabled: boolean
  intervalMinutes: number
  workStartHour: number
  workEndHour: number
  version: number
  /** Unix ms(UTC) */
  updatedAt: number
  updatedBy?: string
}

/** sync-daily 單筆紀錄 payload */
export interface WorkSyncRecordItem {
  /** desktop 本地 SQLite work_records.id;server 端用於 (UserId, LocalId) 冪等 */
  localId: number
  capturedAt: number
  activeApp: string | null
  activeWindowTitle: string | null
  category: WorkCategory
  description: string
  confidence: number | null
  screenshotHash: string | null
  reason: string | null
}

export interface WorkSyncDailyResponse {
  inserted: number
  duplicates: number
  syncedAt: number
  successLocalIds: number[]
}
