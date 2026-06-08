/**
 * sync-config:強制從 DB 重載配置 + 推 PUSH_CONFIG_CHANGED 給 renderer。
 *
 * params: 無
 *
 * 用途:管理員透過 tmbomweb 改了某使用者的 server config(workCollect 那邊已經有
 * /my-config + applyRemoteConfig 流程),但 desktop 端如果還沒到 08:00 / 啟動時刻,
 * 本地 cache 還是舊的。這個腳本強制 desktop 主動「重 load」一次。
 *
 * 注意:此處只重 load 本地 config(DB),不主動拉 server config —— 那是 work-collect 的職責,
 * 本腳本只觸發 ConfigManager.load() 重讀本地 DB 並推 PUSH。
 */

import {IpcChannels} from '../../../shared/ipc-channels'
import type {ScriptContext, ScriptResult} from '../script-runner'
import type {BuiltinScriptDeps} from './index'

export async function syncConfigScript(
    _params: unknown,
    _ctx: ScriptContext,
    deps: BuiltinScriptDeps,
): Promise<ScriptResult> {
    try {
        // ConfigManager.load() 會走 assembleAppConfig(DB) → 更新 in-memory cache
        await deps.configManager.load()

        // 推給主窗 renderer 重 fetch 自己的 store(App.vue 監聽 PUSH_CONFIG_CHANGED 會走 loadConfig)
        // 用 sendToMainWindow 而非 broadcastToWorkRecordViewers —— 配置變更主要影響主窗 UI
        deps.windowManager.sendToMainWindow(IpcChannels.PUSH_CONFIG_CHANGED)

        return {ok: true, summary: 'config reloaded from DB and broadcasted'}
    } catch (err) {
        return {ok: false, summary: `sync-config 失敗: ${(err as Error).message}`}
    }
}
