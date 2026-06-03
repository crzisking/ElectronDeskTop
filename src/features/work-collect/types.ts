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
import type {ActivityState, NewWorkRecord, WorkCategory, WorkRecord} from '../../../electron/main/db/features'

export type {ActivityState, WorkCategory, WorkRecord, NewWorkRecord}

/** main → renderer:採集 tick payload */
export interface WorkCollectTickPayload {
  jpeg: Uint8Array
  activeWindow: string
  appName: string
  allWindows: string[]
  capturedAt: number
  /** 主進程算好的截圖 dHash(16 hex),renderer 拿到不處理,直接帶回 main 寫 DB */
  screenshotHash: string
  /**
   * main 端用本地模板 cache 組好的 system prompt(docs/23 Phase A)。
   * renderer 不解析,原樣透傳給 server。空字串 → server 走 fallback(查 DB 自組)
   */
  prompt: string
  /** 模板合法 code 集合(+ "OTHER")。renderer 不關心,JSON.stringify 後透傳 */
  allowedCodes: string[]
}

// WorkResultPayload 抽到 electron/shared/types,跟 main 共享,避免雙方寫兩份漂移
export type {WorkResultPayload} from '@shared/types/work-collect.types'

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

    /** 業務模板 ID,null=未綁(此情況 desktop 不啟動採集) */
    categoryTemplateId?: number | null
    /** 模板名稱,設定頁顯示「我的崗位」用 */
    templateName?: string | null
  /**
   * 整份模板詳情(docs/23 Phase A)。renderer 拿到後透過 IPC applyRemoteConfig
   * 丟給 main 落 work_template_cache 表,後續 tick 內主進程自己組 prompt。
   */
  templateDetail?: WorkTemplateDetail | null
}

export interface WorkTemplateDetail {
  templateId: number
  version: number
  name: string
  description?: string | null
  promptSnippet?: string | null
  items: WorkTemplateItem[]
}

export interface WorkTemplateItem {
  itemId: number
  code: string
  label: string
  description?: string | null
  color?: string | null
  sortOrder: number
  isActive: boolean
  examples: WorkTemplateExample[]
}

export interface WorkTemplateExample {
  exampleId: number
  content: string
  sortOrder: number
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
    /** 'active' / 'idle';舊版 desktop 沒帶時 server 預設 'active' */
    activityState: ActivityState
}

/**
 * sync-daily 後端回應(對齊 docs/20 §4.1.1 修訂後)。
 *
 * 三組 id 互斥,desktop 只標 success + duplicate 為 synced;
 * failed 留待下次觸發補傳。inserted/duplicates 數字只供 log。
 */
export interface WorkSyncDailyResponse {
  inserted: number
  duplicates: number
  syncedAt: number
  successLocalIds: number[]
  duplicateLocalIds: number[]
  failedLocalIds: number[]
}
