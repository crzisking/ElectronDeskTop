/**
 * 工作採集 IPC handler。協議翻譯 + runtime 校驗,業務在 scheduler / recordService。
 *
 * 所有 handler 對 renderer payload 做 runtime 校驗 —— IPC 雖是 sandbox 內邊界,
 * 仍防 renderer bug / 注入污染 DB / config。
 *
 * 校驗風格:本檔走「primitive guard 組合」(複雜度低、不值得拉 zod 整套 schema)。
 * 共用 primitive 在 utils/runtime-guards;本檔只放結構性 validator(WorkResultPayload 等)。
 * 真要遇到 payload 巢狀深(tool call / streaming chunk 之類)的場景再拉 zod,兩種風格按複雜度選。
 */

import {ipcMain} from 'electron'
import {IpcChannels} from '../../shared/ipc-channels'
import {logger} from '../utils/logger'
import {isArrayOf, isHex16, isIntInRange, isNonNegativeNumber, isPositiveInt} from '../utils/runtime-guards'
import type {ConfigManager} from '../config-manager'
import type {WindowManager} from '../window-manager'
import type {WorkCollectorScheduler, WorkCollectSyncService} from '../work-collect'
import type {WorkRecordService} from '../db/features/work-collect/service'
import type {CachedTemplateDetail, WorkTemplateCacheService} from '../db/features/work-collect/template-cache.service'
import type {
    RemoteConfigPayload,
    WorkResultPayload,
    WorkSyncRunPayload,
    WorkSyncRunResult,
} from '@shared/types/work-collect.types'

// ─── 本檔結構性 validators(primitive 走共用 runtime-guards) ─────────

function validateWorkResult(p: any): p is WorkResultPayload {
    if (!p || typeof p !== 'object') return false
    if (!isPositiveInt(p.capturedAt)) return false
    // 模板化後 category 是動態 code(BOM_MAINT 等),不再固定列舉。
    // 只校驗「非空字串 + 合理長度」 — 跟模板 Code 規範對齊
    if (typeof p.category !== 'string' || p.category.length === 0 || p.category.length > 50) return false
    if (typeof p.description !== 'string') return false
    if (typeof p.confidence !== 'number' || p.confidence < 0 || p.confidence > 1) return false
    if (p.activeApp != null && typeof p.activeApp !== 'string') return false
    if (p.activeWindowTitle != null && typeof p.activeWindowTitle !== 'string') return false
    if (p.screenshotHash != null && !isHex16(p.screenshotHash)) return false
    return !(p.reason != null && typeof p.reason !== 'string')
}

function validateMarkSyncedPayload(p: any): p is { localIds: number[]; syncedAt: number } {
    if (!p || typeof p !== 'object') return false
    if (!isArrayOf(p.localIds, isPositiveInt)) return false
    return isNonNegativeNumber(p.syncedAt)
}

function validateRemoteConfig(p: any): p is RemoteConfigPayload {
    if (!p || typeof p !== 'object') return false
    if (typeof p.enabled !== 'boolean') return false
    if (!isIntInRange(p.intervalMinutes, 1, 60)) return false
    if (!isIntInRange(p.workStartHour, 0, 23)) return false
    if (!isIntInRange(p.workEndHour, 1, 24)) return false
    if (p.workEndHour <= p.workStartHour) return false
    // categoryTemplateId / templateName 為選填,只校驗型別(null / 正整數)
    if (p.categoryTemplateId !== undefined && p.categoryTemplateId !== null
        && !isPositiveInt(p.categoryTemplateId)) return false
    // templateDetail 只校驗最關鍵結構(templateId + version + items array),內部 items 結構放寬
    if (p.templateDetail !== undefined && p.templateDetail !== null) {
        const td = p.templateDetail
        if (typeof td !== 'object') return false
        if (!isPositiveInt(td.templateId)) return false
        if (!Number.isInteger(td.version) || td.version < 1) return false
        if (!Array.isArray(td.items)) return false
    }
    return Number.isInteger(p.version) && p.version >= 1
}

// ─── Handlers ─────────────────────────────────────────────────────────

export interface WorkCollectHandlerDeps {
  scheduler: WorkCollectorScheduler
  recordService: WorkRecordService | null
  configManager: ConfigManager
  windowManager: WindowManager
  templateCacheService: WorkTemplateCacheService | null
  syncService: WorkCollectSyncService | null
}

export function registerWorkCollectHandlers(deps: WorkCollectHandlerDeps): void {
  const {scheduler, recordService, configManager, windowManager, templateCacheService, syncService} = deps

    function validateRunSyncPayload(p: any): p is WorkSyncRunPayload {
        if (!p || typeof p !== 'object') return false
        return typeof p.userName === 'string' && p.userName.length > 0
            && typeof p.token === 'string' && p.token.length > 0
            && typeof p.baseUrl === 'string' && p.baseUrl.length > 0
    }

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
        // 主窗 + LogViewer(若開著)同步收到,LogViewer 內嵌的工作採集 tab 也會跟著 refresh
        windowManager.broadcastToWorkRecordViewers(IpcChannels.PUSH_WORK_RECORD_NEW)
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
        // 有 detail → upsert(覆寫單行 id=1);無 detail(管理員解綁 / 模板被刪 / 被停用) → 清空 cache
        //
        // RemoteConfigPayload.templateDetail 是 unknown(shared 型別不耦合 main 的 CachedTemplateDetail),
        // validateRemoteConfig 已確保 templateId / version / items 三個關鍵欄位存在,這裡安全 cast 即可。
        if (templateCacheService) {
            if (remote.templateDetail) templateCacheService.upsert(remote.templateDetail as CachedTemplateDetail)
            else templateCacheService.clear()
        }

        // 「模板綁了但 detail 拿不到」= server 端模板被刪 / 停用,但 config row 還指著它。
        // 這種狀態下啟 scheduler 也是白搭(tick 送空 prompt → server fallback DB → 撞「模板不可用」),
        // 視為「等同未綁模板」,本地當沒設 templateId 處理,等管理員重新指派。
        const templateUsable = newTemplateId != null && remote.templateDetail != null

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
        if (remote.enabled && templateUsable) {
            scheduler.start()
        } else if (remote.enabled && newTemplateId && !templateUsable) {
            logger.warn(
                `綁定模板 ${newTemplateId} 不可用(server 未返 detail),scheduler 不啟動,等管理員重新指派`,
                'IPC:work',
            )
        }
        scheduler.markConfigSynced()
        logger.info(
            `server 配置已套用 interval=${remote.intervalMinutes} template=${newTemplateId ?? 'null'} usable=${templateUsable} v=${remote.version}`,
            'IPC:work',
        )
        return {changed: true}
    })

    // renderer sync 完成 ack → 清 / 保留 pending
    // 集中化 sync 後 main 自己跑(WORK_COLLECT_RUN_SYNC),main 直接呼 scheduler.markSyncDone,
    // 不再走這個 channel。保留 handler 供舊版 renderer 暫時兼容,新版 renderer 不會呼叫。
    ipcMain.handle(IpcChannels.WORK_COLLECT_SYNC_DONE, (_e, payload: unknown) => {
        const p = (payload ?? {}) as { ok?: unknown; synced?: unknown; failed?: unknown; error?: unknown }
        const ok = p.ok === true
        scheduler.markSyncDone(ok, typeof p.error === 'string' ? p.error : undefined)
        if (ok) {
            logger.info(`sync 完成 synced=${Number(p.synced) || 0} failed=${Number(p.failed) || 0}`, 'IPC:work')
        }
    })

    // 主進程 sync 主流程(集中化:取代 listUnsynced + HTTP + markSynced 的 50× IPC 來回)
    ipcMain.handle(IpcChannels.WORK_COLLECT_RUN_SYNC, async (_e, payload: unknown): Promise<WorkSyncRunResult> => {
        if (!syncService) {
            return {ok: false, synced: 0, failed: 0, hitLimit: false, error: 'sync service not ready'}
        }
        if (!validateRunSyncPayload(payload)) {
            logger.warn('WORK_COLLECT_RUN_SYNC payload 校驗失敗,丟棄', 'IPC:work')
            return {ok: false, synced: 0, failed: 0, hitLimit: false, error: 'invalid payload'}
        }
        const result = await syncService.run(payload)
        // 內聯 markSyncDone(取代渲染端 syncDone IPC):main 自己跑就由 main 自己 ack scheduler
        scheduler.markSyncDone(result.ok, result.error)
        return result
    })

    // renderer bootstrap ack → 重放 pending
    ipcMain.handle(IpcChannels.WORK_COLLECT_RENDERER_READY, () => {
        scheduler.onRendererReady()
    })

    // 讀本地模板 cache,給 renderer 建 code → label 對照表(UI 顯示用)
    ipcMain.handle(IpcChannels.WORK_COLLECT_GET_TEMPLATE, (): CachedTemplateDetail | null => {
        if (!templateCacheService) return null
        return templateCacheService.read()
    })

    // 採集健康狀態:service 計數 + 當前 unsynced 數
    ipcMain.handle(IpcChannels.WORK_COLLECT_HEALTH, () => {
        if (!recordService) {
            return {pendingSync: 0, writeFailures: 0, markFailures: 0, lastError: 'DB not ready', lastErrorAt: null}
        }
        return {pendingSync: recordService.countUnsynced(), ...recordService.getHealth()}
    })
}
