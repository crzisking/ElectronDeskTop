/**
 * 工作採集 IPC handler。
 *
 * Channels:
 *  - WORK_COLLECT_TOGGLE:切換採集開關,改 config 並啟停 scheduler
 *  - WORK_COLLECT_LIST:查詢採集紀錄,給流水線 UI 用
 *  - WORK_COLLECT_RESULT:渲染端拿到 AI 結果後送回,主進程寫 DB + 推 PUSH_WORK_RECORD_NEW
 *  - WORK_COLLECT_LIST_UNSYNCED / WORK_COLLECT_MARK_SYNCED / WORK_COLLECT_APPLY_REMOTE_CONFIG:集中化 sync(docs/20)
 *  - WORK_COLLECT_RENDERER_READY:bootstrap ack,觸發 main 補推 pending request
 *
 * 所有 handler 對 renderer payload 都做 runtime validation —— 即使是 sandbox 內部 IPC,
 * 也避免 renderer bug / 注入導致 DB 污染或 config 異常。
 *
 * 主進程 scheduler 透過 PUSH_WORK_COLLECT_TICK 推採集事件給渲染端,
 * 那是 scheduler 內 webContents.send 直接觸發,不需要 handler。
 */

import {ipcMain} from 'electron'
import {IpcChannels} from '../../shared/ipc-channels'
import {logger} from '../utils/logger'
import type {ConfigManager} from '../config-manager'
import type {WindowManager} from '../window-manager'
import type {WorkCollectorScheduler} from '../work-collector'
import type {WorkRecordService} from '../db/features/work-collect/service'
import type {WorkCategory} from '../db/features'

/** WORK_COLLECT_RESULT 的 payload 形狀,跟 renderer 端 IPC 呼叫對齊 */
interface WorkResultPayload {
  capturedAt: number
  activeApp: string | null
  activeWindowTitle: string | null
  category: WorkCategory
  description: string
  confidence: number
    /** 截圖 dHash(16 hex),由主進程 scheduler 算好帶到 renderer 再回送 */
    screenshotHash: string | null
    /** AI 對分類理由的說明,可空(模型偶爾不輸出) */
    reason: string | null
}

// ─── Runtime guards ────────────────────────────────────────────────
// 即使 IPC 是 sandbox 內邊界,renderer 仍可能因 bug / 注入發異常 payload。
// 統一在這層擋,讓 DB 與 config 永遠收到合法資料。
// 不引入 zod(整個專案目前未用),手寫 guard 已足夠。

const VALID_CATEGORIES = new Set<WorkCategory>([
    'coding', 'documenting', 'browsing', 'communicating',
    'meeting', 'designing', 'idle', 'other',
])

function isPositiveInt(v: unknown): v is number {
    return typeof v === 'number' && Number.isInteger(v) && v > 0
}

function isNonNegativeNumber(v: unknown): v is number {
    return typeof v === 'number' && Number.isFinite(v) && v >= 0
}

function validateWorkResult(p: any): p is WorkResultPayload {
    if (!p || typeof p !== 'object') return false
    if (!isPositiveInt(p.capturedAt)) return false
    if (!VALID_CATEGORIES.has(p.category)) return false
    if (typeof p.description !== 'string') return false
    if (typeof p.confidence !== 'number' || p.confidence < 0 || p.confidence > 1) return false
    if (p.activeApp != null && typeof p.activeApp !== 'string') return false
    if (p.activeWindowTitle != null && typeof p.activeWindowTitle !== 'string') return false
    // dHash 是 16 hex 字元(8 byte);長度不對就視為髒資料但不阻擋(舊紀錄沒這欄)
    if (p.screenshotHash != null && (typeof p.screenshotHash !== 'string' || !/^[0-9a-fA-F]{16}$/.test(p.screenshotHash))) {
        return false
    }
    return !(p.reason != null && typeof p.reason !== 'string');

}

function validateMarkSyncedPayload(p: any): p is { localIds: number[]; syncedAt: number } {
    if (!p || typeof p !== 'object') return false
    if (!Array.isArray(p.localIds)) return false
    if (!p.localIds.every(isPositiveInt)) return false
    return isNonNegativeNumber(p.syncedAt);

}

interface RemoteConfigPayload {
    enabled: boolean
    intervalMinutes: number
    workStartHour: number
    workEndHour: number
    version: number
}

function validateRemoteConfig(p: any): p is RemoteConfigPayload {
    if (!p || typeof p !== 'object') return false
    if (typeof p.enabled !== 'boolean') return false
    if (!Number.isInteger(p.intervalMinutes) || p.intervalMinutes < 1 || p.intervalMinutes > 60) return false
    if (!Number.isInteger(p.workStartHour) || p.workStartHour < 0 || p.workStartHour > 23) return false
    if (!Number.isInteger(p.workEndHour) || p.workEndHour < 1 || p.workEndHour > 24) return false
    if (p.workEndHour <= p.workStartHour) return false
    return !(!Number.isInteger(p.version) || p.version < 1);

}

export function registerWorkCollectHandlers(
  scheduler: WorkCollectorScheduler,
  recordService: WorkRecordService | null,
  configManager: ConfigManager,
  windowManager: WindowManager
): void {

  // ── 切換採集開關 ──────────────────────────────────────────────────
  ipcMain.handle(
    IpcChannels.WORK_COLLECT_TOGGLE,
      async (_event, enabled: unknown): Promise<boolean> => {
          if (typeof enabled !== 'boolean') {
              logger.warn(`WORK_COLLECT_TOGGLE 收到非 boolean payload,忽略`, 'IPC:work')
              return configManager.getConfig().workCollect?.enabled ?? false
          }
      await configManager.writeConfig({
        workCollect: {
          ...configManager.getConfig().workCollect,
          enabled,
        },
      })
          if (enabled) scheduler.start()
          else scheduler.stop()
      logger.info(`工作採集已${enabled ? '啟用' : '停用'}`, 'IPC:work')
      return enabled
    }
  )

  // ── 查詢紀錄 ──────────────────────────────────────────────────────
  ipcMain.handle(
    IpcChannels.WORK_COLLECT_LIST,
      (_event, params: unknown) => {
      if (!recordService) return []
          const p = params as { since?: unknown; until?: unknown }
          if (!isNonNegativeNumber(p?.since) || !isNonNegativeNumber(p?.until) || p.until <= p.since) {
              logger.warn('WORK_COLLECT_LIST payload 非法,返回空', 'IPC:work')
              return []
          }
          return recordService.listByRange(p.since, p.until)
    }
  )

    // ── 渲染端回送 AI 結果 → 寫 DB + 通知刷新 ─────────────────────────
  ipcMain.on(
    IpcChannels.WORK_COLLECT_RESULT,
      (_event, payload: unknown) => {
      if (!recordService) {
        logger.warn('WORK_COLLECT_RESULT 來了但 DB service 不可用', 'IPC:work')
        return
      }
          if (!validateWorkResult(payload)) {
              logger.warn(`WORK_COLLECT_RESULT payload 校驗失敗,丟棄`, 'IPC:work', payload)
              return
          }

          const result = recordService.insert({
              capturedAt: payload.capturedAt,
              activeApp: payload.activeApp,
        activeWindowTitle: payload.activeWindowTitle,
              category: payload.category,
              description: payload.description,
              confidence: payload.confidence,
              screenshotHash: payload.screenshotHash,
              reason: payload.reason,
      })

          if (!result.ok) {
              // 寫入失敗:不通知 UI 刷新(沒新行),log 詳細原因供事後排查
              logger.warn(`AI 結果寫入失敗 reason=${result.reason} category=${payload.category}`, 'IPC:work')
              return
          }
      windowManager.getMainWindow()?.webContents.send(IpcChannels.PUSH_WORK_RECORD_NEW)
      logger.debug(`紀錄已寫入 category=${payload.category}`, 'IPC:work')
    }
  )

    // ── 集中化(docs/20):server sync 三條 IPC ──────────────────────────

    ipcMain.handle(
        IpcChannels.WORK_COLLECT_LIST_UNSYNCED,
        (_event, limit: unknown) => {
            if (!recordService) return []
            // limit 容錯:非合法數字直接用 200
            const safeLimit = Number.isInteger(limit) && (limit as number) > 0
                ? Math.min(limit as number, 500)
                : 200
            return recordService.listUnsynced(safeLimit)
        }
    )

    ipcMain.handle(
        IpcChannels.WORK_COLLECT_MARK_SYNCED,
        (_event, payload: unknown) => {
            logger.info(`收到 MARK_SYNCED 請求 payload=${JSON.stringify(payload)?.slice(0, 200)}`, 'IPC:work')
            if (!recordService) return {ok: false, reason: 'DB not ready'} as const
            if (!validateMarkSyncedPayload(payload)) {
                logger.warn('WORK_COLLECT_MARK_SYNCED payload 校驗失敗,丟棄', 'IPC:work', payload)
                return {ok: false, reason: 'invalid payload'} as const
            }
            return recordService.markSynced(payload.localIds, payload.syncedAt)
        }
    )

    ipcMain.handle(
        IpcChannels.WORK_COLLECT_APPLY_REMOTE_CONFIG,
        async (_event, remote: unknown): Promise<{ changed: boolean }> => {
            if (!validateRemoteConfig(remote)) {
                logger.warn('WORK_COLLECT_APPLY_REMOTE_CONFIG payload 校驗失敗,丟棄', 'IPC:work', remote)
                return {changed: false}
            }
            const current = configManager.getConfig().workCollect
            const changed = !current
                || current.enabled !== remote.enabled
                || current.intervalMinutes !== remote.intervalMinutes
                || current.workStartHour !== remote.workStartHour
                || current.workEndHour !== remote.workEndHour

            if (!changed) {
                logger.debug('server 配置與本地一致,不需更新', 'IPC:work')
                // ack scheduler:本日 config sync 完成,即使內容沒變
                scheduler.markConfigSynced()
                return {changed: false}
            }

            await configManager.writeConfig({
                workCollect: {
                    enabled: remote.enabled,
                    intervalMinutes: remote.intervalMinutes,
                    workStartHour: remote.workStartHour,
                    workEndHour: remote.workEndHour,
                },
            })

            scheduler.stop()
            if (remote.enabled) scheduler.start()
            scheduler.markConfigSynced()

            logger.info(
                `server 配置已套用 enabled=${remote.enabled} interval=${remote.intervalMinutes} v=${remote.version}`,
                'IPC:work'
            )
            return {changed: true}
        }
    )

    // ── Renderer bootstrap ack ─────────────────────────────────────────
    // Renderer 訂閱完成 PUSH_WORK_COLLECT_CONFIG_REQUEST / SYNC_REQUEST 後 invoke 此 channel。
    // Scheduler 收到 ack 補推任何曾失敗的 request,處理「main 早於 renderer ready」的競態。
    ipcMain.handle(
        IpcChannels.WORK_COLLECT_RENDERER_READY,
        () => {
            logger.info('Renderer ready,補推 pending config/sync request', 'IPC:work')
            scheduler.onRendererReady()
        }
    )
}
