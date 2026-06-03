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
import type {WorkCollectorScheduler} from '../work-collect'
import type {WorkRecordService} from '../db/features/work-collect/service'
import type {CachedTemplateDetail, WorkTemplateCacheService} from '../db/features/work-collect/template-cache.service'
import type {RemoteConfigPayload, WorkResultPayload} from '@shared/types/work-collect.types'

// ─── Runtime guards ──────────────────────────────────────────────────

function isPositiveInt(v: unknown): v is number {
    return typeof v === 'number' && Number.isInteger(v) && v > 0
}

function isNonNegativeNumber(v: unknown): v is number {
    return typeof v === 'number' && Number.isFinite(v) && v >= 0
}

function validateWorkResult(p: any): p is WorkResultPayload {
    if (!p || typeof p !== 'object') return false
    if (!isPositiveInt(p.capturedAt)) return false
    // 模板化後 category 是動態 code(BOM_MAINT 等),不再固定列舉。
    // 只校驗「非空字串 + 合理長度 + 大寫英數底線」 — 跟模板 Code 規範對齊
    if (typeof p.category !== 'string' || p.category.length === 0 || p.category.length > 50) return false
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
    // templateDetail 只校驗最關鍵結構(templateId + version + items array),內部 items 結構放寬
    if (p.templateDetail !== undefined && p.templateDetail !== null) {
        const td = p.templateDetail
        if (typeof td !== 'object') return false
        if (!Number.isInteger(td.templateId) || td.templateId <= 0) return false
        if (!Number.isInteger(td.version) || td.version < 1) return false
        if (!Array.isArray(td.items)) return false
    }
    return Number.isInteger(p.version) && p.version >= 1
}

// ─── Handlers ─────────────────────────────────────────────────────────

export function registerWorkCollectHandlers(
  scheduler: WorkCollectorScheduler,
  recordService: WorkRecordService | null,
  configManager: ConfigManager,
  windowManager: WindowManager,
  templateCacheService: WorkTemplateCacheService | null,
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

        // ── 模板 cache 寫入(獨立於 KV config 變更判斷;templateDetail 隨 my-config 一起來) ──
        // 有 detail → upsert(覆寫單行 id=1);無 detail(管理員解綁) → 清空 cache
        //
        // RemoteConfigPayload.templateDetail 是 unknown(shared 型別不耦合 main 的 CachedTemplateDetail),
        // validateRemoteConfig 已確保 templateId / version / items 三個關鍵欄位存在,這裡安全 cast 即可。
        if (templateCacheService) {
            if (remote.templateDetail) templateCacheService.upsert(remote.templateDetail as CachedTemplateDetail)
            else templateCacheService.clear()
        }

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
