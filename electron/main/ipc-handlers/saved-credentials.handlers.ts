/**
 * 「記住密碼」IPC handler。
 *
 * Channels:
 *  - SAVED_CREDENTIALS_GET  :App.vue 啟動鉤子讀,有就走自動登入
 *  - SAVED_CREDENTIALS_SAVE :LoginView 勾「記住密碼」登入成功時寫入
 *  - SAVED_CREDENTIALS_CLEAR:logout / 首頁清除按鈕呼叫
 *
 * Payload 校驗:走 utils/runtime-guards 共用 isNonEmptyString
 * (對齊 work-collect.handlers 的淺層物件 guard 風格)。
 */

import {ipcMain} from 'electron'
import {IpcChannels} from '../../shared/ipc-channels'
import {logger} from '../utils/logger'
import {isNonEmptyString} from '../utils/runtime-guards'
import type {SavedCredentialsService} from '../db/features/saved-credentials/service'
import type {SavedCredential} from '../db/features'

interface SavePayload {
    userId: string
    password: string
}

function isSavePayload(v: unknown): v is SavePayload {
    if (typeof v !== 'object' || v === null) return false
    const p = v as Partial<SavePayload>
    return isNonEmptyString(p.userId) && typeof p.password === 'string'
}

export function registerSavedCredentialsHandlers(
    service: SavedCredentialsService | null
): void {
    ipcMain.handle(
        IpcChannels.SAVED_CREDENTIALS_GET,
        (): SavedCredential | null => {
            if (!service) return null
            return service.get()
        }
    )

    ipcMain.handle(
        IpcChannels.SAVED_CREDENTIALS_SAVE,
        (_event, payload: unknown): boolean => {
            if (!service) {
                logger.warn('SAVED_CREDENTIALS_SAVE 來了但 DB service 不可用', 'IPC:saved-credentials')
                return false
            }
            if (!isSavePayload(payload)) {
                logger.warn('SAVED_CREDENTIALS_SAVE payload 格式錯誤', 'IPC:saved-credentials')
                return false
            }
            return service.save({userId: payload.userId, password: payload.password})
        }
    )

    ipcMain.handle(
        IpcChannels.SAVED_CREDENTIALS_CLEAR,
        (): boolean => {
            if (!service) return false
            return service.clear()
        }
    )
}
