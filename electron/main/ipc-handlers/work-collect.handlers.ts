/**
 * 工作採集 IPC handler。
 *
 * 三個 channel:
 *  - WORK_COLLECT_SET_AUTH:渲染端 → 主進程,送 token + apiBaseUrl 進來
 *  - WORK_COLLECT_TOGGLE:切換採集開關,改 config 並啟停 scheduler
 *  - WORK_COLLECT_LIST:查詢採集紀錄,給流水線 UI 用
 *
 * 主進程也透過 PUSH_WORK_RECORD_NEW 推播事件給渲染端,
 * 但那是 scheduler 內 webContents.send 直接觸發,不需要 handler。
 */

import {ipcMain} from 'electron'
import {IpcChannels} from '../../shared/ipc-channels'
import {logger} from '../utils/logger'
import type {ConfigManager} from '../config-manager'
import type {WorkCollectorScheduler} from '../work-collector'
import type {WorkRecordService} from '../db/services/work-record.service'

export function registerWorkCollectHandlers(
  scheduler: WorkCollectorScheduler,
  recordService: WorkRecordService | null,
  configManager: ConfigManager
): void {

  // ── 設定 auth context(token + apiBaseUrl)─────────────────────────
  ipcMain.on(
    IpcChannels.WORK_COLLECT_SET_AUTH,
    (_event, payload: {token: string | null; apiBaseUrl: string}) => {
      scheduler.setAuthContext(payload.token, payload.apiBaseUrl)
      logger.debug(
        `Auth context 更新 token=${payload.token ? '***' : 'null'} url=${payload.apiBaseUrl}`,
        'IPC:work'
      )
    }
  )

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
}
