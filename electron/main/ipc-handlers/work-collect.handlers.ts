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
import type {WorkCategory} from '../db/features/work-collect/schema'

/** WORK_COLLECT_RESULT 的 payload 形狀,跟 renderer 端 IPC 呼叫對齊 */
interface WorkResultPayload {
  capturedAt: number
  activeApp: string | null
  activeWindowTitle: string | null
  category: WorkCategory
  description: string
  confidence: number
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

  // ── 渲染端回送 AI 結果 → 寫 DB + 通知刷新 ────────────────────────
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
      })

      // 通知渲染端刷新流水線(可能不只是觸發的那扇窗,future-proof)
      windowManager.getMainWindow()?.webContents.send(IpcChannels.PUSH_WORK_RECORD_NEW)

      logger.debug(`紀錄已寫入 category=${payload.category}`, 'IPC:work')
    }
  )
}
