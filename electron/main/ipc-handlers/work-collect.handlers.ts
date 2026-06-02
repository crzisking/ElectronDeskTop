/**
 * 工作採集 IPC handler。協議翻譯 + runtime 校驗,業務在 scheduler / recordService。
 *
 * 所有 handler 對 renderer payload 做 runtime 校驗 —— IPC 雖是 sandbox 內邊界,
 * 仍防 renderer bug / 注入污染 DB / config。不引入 zod,手寫 guard 足夠。
 */

import {ipcMain} from 'electron'
import {IpcChannels} from '../../shared/ipc-channels'
import {logger} from '../utils/logger'
import type {ConfigManager} from '../config-manager'
import type {WindowManager} from '../window-manager'
import type {WorkCollectorScheduler} from '../work-collector'
import type {WorkRecordService} from '../db/features/work-collect/service'
import type {WorkCategory} from '../db/features'

interface WorkResultPayload {
  capturedAt: number
  activeApp: string | null
  activeWindowTitle: string | null
  category: WorkCategory
  description: string
  confidence: number
    screenshotHash: string | null
    reason: string | null
}

// ─── Runtime guards ──────────────────────────────────────────────────

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
    if (p.screenshotHash != null && (typeof p.screenshotHash !== 'string' || !/^[0-9a-fA-F]{16}$/.test(p.screenshotHash))) return false
    return !(p.reason != null && typeof p.reason !== 'string')
}

function validateMarkSyncedPayload(p: any): p is { localIds: number[]; syncedAt: number } {
    if (!p || typeof p !== 'object') return false
    if (!Array.isArray(p.localIds) || !p.localIds.every(isPositiveInt)) return false
    return isNonNegativeNumber(p.syncedAt)
}

interface RemoteConfigPayload {
    enabled: boolean
    intervalMinutes: number
    workStartHour: number
    workEndHour: number
    version: number
    /** 模板 ID,null=未綁(scheduler 不啟動) */
    categoryTemplateId?: number | null
    templateName?: string | null
}

function validateRemoteConfig(p: any): p is RemoteConfigPayload {
    if (!p || typeof p !== 'object') return false
    if (typeof p.enabled !== 'boolean') return false
    if (!Number.isInteger(p.intervalMinutes) || p.intervalMinutes < 1 || p.intervalMinutes > 60) return false
    if (!Number.isInteger(p.workStartHour) || p.workStartHour < 0 || p.workStartHour > 23) return false
    if (!Number.isInteger(p.workEndHour) || p.workEndHour < 1 || p.workEndHour > 24) return false
    if (p.workEndHour <= p.workStartHour) return false
    // categoryTemplateId / templateName 為選填,只校驗型別(null / number / string)
    if (p.categoryTemplateId !== undefined && p.categoryTemplateId !== null
        && !(Number.isInteger(p.categoryTemplateId) && p.categoryTemplateId > 0)) return false
    return Number.isInteger(p.version) && p.version >= 1
}

// ─── Handlers ─────────────────────────────────────────────────────────

export function registerWorkCollectHandlers(
  scheduler: WorkCollectorScheduler,
  recordService: WorkRecordService | null,
  configManager: ConfigManager,
  windowManager: WindowManager,
): void {

    // 切換採集開關
    ipcMain.handle(IpcChannels.WORK_COLLECT_TOGGLE, async (_e, enabled: unknown): Promise<boolean> => {
        if (typeof enabled !== 'boolean') return configManager.getConfig().workCollect?.enabled ?? false
        await configManager.writeConfig({workCollect: {...configManager.getConfig().workCollect, enabled}})
        if (enabled) scheduler.start()
        else scheduler.stop()
        logger.info(`採集已${enabled ? '啟用' : '停用'}`, 'IPC:work')
      return enabled
    })

    // 查紀錄
    ipcMain.handle(IpcChannels.WORK_COLLECT_LIST, (_e, params: unknown) => {
      if (!recordService) return []
        const p = params as { since?: unknown; until?: unknown }
        if (!isNonNegativeNumber(p?.since) || !isNonNegativeNumber(p?.until) || p.until <= p.since) return []
        return recordService.listByRange(p.since, p.until)
    })

    // renderer 回送 AI 結果 → 寫 DB
    ipcMain.on(IpcChannels.WORK_COLLECT_RESULT, (_e, payload: unknown) => {
        if (!recordService) return
        if (!validateWorkResult(payload)) {
            logger.warn('WORK_COLLECT_RESULT 校驗失敗,丟棄', 'IPC:work')
            return
        }
        const result = recordService.insert(payload)
        if (!result.ok) {
            logger.warn(`AI 結果寫入失敗 reason=${result.reason}`, 'IPC:work')
            return
        }
      windowManager.getMainWindow()?.webContents.send(IpcChannels.PUSH_WORK_RECORD_NEW)
    })

    // ── 集中化 sync ──────────────────────────────────────────────────

    ipcMain.handle(IpcChannels.WORK_COLLECT_LIST_UNSYNCED, (_e, limit: unknown) => {
        if (!recordService) return []
        const safe = Number.isInteger(limit) && (limit as number) > 0 ? Math.min(limit as number, 500) : 200
        return recordService.listUnsynced(safe)
    })

    ipcMain.handle(IpcChannels.WORK_COLLECT_MARK_SYNCED, (_e, payload: unknown) => {
        if (!recordService) return {ok: false, reason: 'DB not ready'} as const
        if (!validateMarkSyncedPayload(payload)) {
            logger.warn('WORK_COLLECT_MARK_SYNCED 校驗失敗,丟棄', 'IPC:work')
            return {ok: false, reason: 'invalid payload'} as const
        }
        return recordService.markSynced(payload.localIds, payload.syncedAt)
    })

    ipcMain.handle(IpcChannels.WORK_COLLECT_APPLY_REMOTE_CONFIG, async (_e, remote: unknown): Promise<{
        changed: boolean
    }> => {
        if (!validateRemoteConfig(remote)) {
            logger.warn('WORK_COLLECT_APPLY_REMOTE_CONFIG 校驗失敗,丟棄', 'IPC:work')
            return {changed: false}
        }
        const current = configManager.getConfig().workCollect
        const newTemplateId = remote.categoryTemplateId ?? null
        const changed = !current
            || current.enabled !== remote.enabled
            || current.intervalMinutes !== remote.intervalMinutes
            || current.workStartHour !== remote.workStartHour
            || current.workEndHour !== remote.workEndHour
            || (current.categoryTemplateId ?? null) !== newTemplateId
            || (current.templateName ?? null) !== (remote.templateName ?? null)

        if (!changed) {
            scheduler.markConfigSynced()
            return {changed: false}
        }
        await configManager.writeConfig({
            workCollect: {
                enabled: remote.enabled,
                intervalMinutes: remote.intervalMinutes,
                workStartHour: remote.workStartHour,
                workEndHour: remote.workEndHour,
                categoryTemplateId: newTemplateId,
                templateName: remote.templateName ?? null,
            },
        })
        scheduler.stop()
        // 啟用 + 已綁模板才真的起 scheduler;沒模板等同設定不完整
        if (remote.enabled && newTemplateId) scheduler.start()
        scheduler.markConfigSynced()
        logger.info(
            `server 配置已套用 interval=${remote.intervalMinutes} template=${newTemplateId ?? 'null'} v=${remote.version}`,
            'IPC:work',
        )
        return {changed: true}
    })

    // renderer sync 完成 ack → 清 / 保留 pending
    ipcMain.handle(IpcChannels.WORK_COLLECT_SYNC_DONE, (_e, payload: unknown) => {
        const p = (payload ?? {}) as { ok?: unknown; synced?: unknown; failed?: unknown; error?: unknown }
        const ok = p.ok === true
        scheduler.markSyncDone(ok, typeof p.error === 'string' ? p.error : undefined)
        if (ok) {
            logger.info(`sync 完成 synced=${Number(p.synced) || 0} failed=${Number(p.failed) || 0}`, 'IPC:work')
        }
    })

    // renderer bootstrap ack → 重放 pending
    ipcMain.handle(IpcChannels.WORK_COLLECT_RENDERER_READY, () => {
        scheduler.onRendererReady()
    })

    // 採集健康狀態:service 計數 + 當前 unsynced 數
    ipcMain.handle(IpcChannels.WORK_COLLECT_HEALTH, () => {
        if (!recordService) {
            return {pendingSync: 0, writeFailures: 0, markFailures: 0, lastError: 'DB not ready', lastErrorAt: null}
        }
        return {pendingSync: recordService.countUnsynced(), ...recordService.getHealth()}
    })
}
