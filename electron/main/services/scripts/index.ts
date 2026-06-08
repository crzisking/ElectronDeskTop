/**
 * 內建腳本註冊入口。
 *
 * 對齊 docs/18-遠程通知與內置腳本執行設計.md §5 的 6 個腳本清單。
 *
 * 注入模式:每個 script 是純 function (params, ctx, deps) → ScriptResult,
 * registerBuiltinScripts() 把當下 main process 的 manager 引用注入給每個腳本,
 * runner 內只看到 (params, ctx) → result 簡單介面。
 */

import type {ScriptRunner} from '../script-runner'
import type {ConfigManager} from '../../config-manager'
import type {WindowManager} from '../../window-manager'
import type {LogService} from '../../db/features/logs/service'
import {showMessageScript} from './show-message.script'
import {clearCacheScript} from './clear-cache.script'
import {restartAppScript} from './restart-app.script'
import {collectLogsScript} from './collect-logs.script'
import {syncConfigScript} from './sync-config.script'
import {runDiagnosticScript} from './run-diagnostic.script'

export interface BuiltinScriptDeps {
    configManager: ConfigManager
    windowManager: WindowManager
    logService: LogService | null
}

/** 對齊 server NotificationsService.ALLOWED_ACTIONS 白名單;改名要兩處一起改 */
export function registerBuiltinScripts(runner: ScriptRunner, deps: BuiltinScriptDeps): void {
    runner.register('show-message', (p, ctx) => showMessageScript(p, ctx))
    runner.register('clear-cache', (p, ctx) => clearCacheScript(p, ctx, deps))
    runner.register('restart-app', (p, ctx) => restartAppScript(p, ctx, deps))
    runner.register('collect-logs', (p, ctx) => collectLogsScript(p, ctx))
    runner.register('sync-config', (p, ctx) => syncConfigScript(p, ctx, deps))
    runner.register('run-diagnostic', (p, ctx) => runDiagnosticScript(p, ctx))
}
