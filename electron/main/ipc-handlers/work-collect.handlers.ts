/**
 * 工作採集 IPC handler。
 *
 * Channels:
 *  - WORK_COLLECT_TOGGLE:切換採集開關,改 config 並啟停 scheduler
 *  - WORK_COLLECT_LIST:查詢採集紀錄,給流水線 UI 用
 *  - WORK_COLLECT_RESULT:渲染端拿到 AI 結果後送回,主進程寫 DB + 推 PUSH_WORK_RECORD_NEW
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

export function registerWorkCollectHandlers(
  scheduler: WorkCollectorScheduler,
  recordService: WorkRecordService | null,
  configManager: ConfigManager,
  windowManager: WindowManager
): void {

  // ── 切換採集開關 ──────────────────────────────────────────────────
  ipcMain.handle(
    IpcChannels.WORK_COLLECT_TOGGLE,
    async (_event, enabled: boolean): Promise<boolean> => {
      // 1. 寫進 config(會落地到 app-config.json,下次啟動沿用)
      await configManager.writeConfig({
        workCollect: {
          ...configManager.getConfig().workCollect,
          enabled,
        },
      })
      // 2. 啟動 / 停止 scheduler
      if (enabled) {
        scheduler.start()
      } else {
        scheduler.stop()
      }
      logger.info(`工作採集已${enabled ? '啟用' : '停用'}`, 'IPC:work')
      return enabled
    }
  )

  // ── 查詢紀錄 ──────────────────────────────────────────────────────
  ipcMain.handle(
    IpcChannels.WORK_COLLECT_LIST,
    (_event, params: {since: number; until: number}) => {
      if (!recordService) return []
      return recordService.listByRange(params.since, params.until)
    }
  )

    // ── 渲染端回送 AI 結果 → 寫 DB + 通知刷新
  ipcMain.on(
    IpcChannels.WORK_COLLECT_RESULT,
    (_event, payload: WorkResultPayload) => {
      if (!recordService) {
        logger.warn('WORK_COLLECT_RESULT 來了但 DB service 不可用', 'IPC:work')
        return
      }

      recordService.insert({
        capturedAt: payload.capturedAt,
        activeApp: payload.activeApp,
        activeWindowTitle: payload.activeWindowTitle,
        category: payload.category,
        description: payload.description,
        confidence: payload.confidence,
          screenshotHash: payload.screenshotHash,
          reason: payload.reason,
      })

      // 通知渲染端刷新流水線(可能不只是觸發的那扇窗,future-proof)
      windowManager.getMainWindow()?.webContents.send(IpcChannels.PUSH_WORK_RECORD_NEW)

      logger.debug(`紀錄已寫入 category=${payload.category}`, 'IPC:work')
    }
  )

    // ── 集中化(docs/20):server sync 三條 IPC ──────────────────────────

    /** 撈未同步紀錄(synced=0) */
    ipcMain.handle(
        IpcChannels.WORK_COLLECT_LIST_UNSYNCED,
        (_event, limit: number = 200) => {
            if (!recordService) return []
            return recordService.listUnsynced(limit)
        }
    )

    /** sync-daily 成功後標記已同步 */
    ipcMain.handle(
        IpcChannels.WORK_COLLECT_MARK_SYNCED,
        (_event, payload: { localIds: number[]; syncedAt: number }) => {
            if (!recordService) return
            recordService.markSynced(payload.localIds ?? [], payload.syncedAt ?? Date.now())
        }
    )

    /**
     * server 配置回來 → 寫進 ConfigManager。
     * 比對舊版本決定是否 restart scheduler;若 enabled 變化也跟著啟停。
     *
     * 注意:管理員可改 enabled,所以本機 toggle 跟 server 同步存在「最終以 server 為準」的競態 ——
     * 設計上接受,因為使用者每天 8 點(以及啟動)會被覆蓋一次,中間時段自己的 toggle 仍有效。
     */
    ipcMain.handle(
        IpcChannels.WORK_COLLECT_APPLY_REMOTE_CONFIG,
        async (_event, remote: {
            enabled: boolean
            intervalMinutes: number
            workStartHour: number
            workEndHour: number
            version: number
        }): Promise<{ changed: boolean }> => {
            const current = configManager.getConfig().workCollect
            // 比對 4 個欄位,任一不同就視為變更(version 不直接比,因為本地不存)
            const changed = !current
                || current.enabled !== remote.enabled
                || current.intervalMinutes !== remote.intervalMinutes
                || current.workStartHour !== remote.workStartHour
                || current.workEndHour !== remote.workEndHour

            if (!changed) {
                logger.debug('server 配置與本地一致,不需更新', 'IPC:work')
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

            // 配置變了 → 重啟 scheduler 套用新 interval / 啟停依 enabled
            scheduler.stop()
            if (remote.enabled) {
                scheduler.start()
            }
            logger.info(
                `server 配置已套用 enabled=${remote.enabled} interval=${remote.intervalMinutes} v=${remote.version}`,
                'IPC:work'
            )
            return {changed: true}
        }
    )
}
