/**
 * Agent 功能 IPC handler — 純協議翻譯層。
 *
 * 兩類 channel:
 *  1. AGENT_OPEN_WINDOW:任意窗口開 Agent 獨立窗口
 *  2. agent:exec-tool / agent:read-config / ...:Agent 窗口自身的 IPC 出口
 *
 * 分層原則:本檔**不寫業務邏輯**,所有實作委派出去:
 *  - 工具執行 → AgentToolService
 *  - DB 讀寫 → AgentService
 *  - 開窗 → WindowManager
 *
 * 之前版本曾把 8 個工具的 fs / execFile / desktopCapturer 實作直接寫在本檔(200+ 行),
 * 已搬到 `electron/main/services/agent-tool.service.ts`(對齊 LogService 等分層慣例)。
 */

import {ipcMain} from 'electron'
import {z} from 'zod'
import {IpcChannels} from '../../shared/ipc-channels'
import {logger} from '../utils/logger'
import type {WindowManager} from '../window-manager'
import type {AgentConfig, AgentMessage, AgentService} from '../db/features/agent/service'
import type {AgentToolService} from '../services/agent-tool.service'

/**
 * agent:exec-tool 的 payload schema(§1.2 — 高風險 handler 強化驗證)。
 *
 * 動機:此 handler 是 Agent 透過 IPC 執行系統命令的唯一入口,惡意 / 有 bug 的渲染端
 * 可能傳入非預期形狀(例:name 為 null、args 為陣列)。zod 在 throw 之前 narrow 型別,
 * 失敗時返回統一錯誤而非崩潰。
 *
 * 灰度策略:目前用 safeParse,失敗時記 warn + 返回錯誤。觀察 1 週確認沒誤殺合法請求後,
 * 可改成 parse(失敗 throw)。其它 handler(config:write 已有 key whitelist;repair:upload
 * 走 HTTP 不是 IPC)暫不加。
 */
const ExecToolPayloadSchema = z.object({
    name: z.string().min(1, 'tool name 不能為空'),
    args: z.record(z.string(), z.unknown()).optional().default({}),
})

export function registerAgentHandlers(
    windowManager: WindowManager,
    agentService: AgentService | null,
    agentToolService: AgentToolService,
): void {
    // ── 開窗 ─────────────────────────────────────────────────────────
    ipcMain.on(IpcChannels.AGENT_OPEN_WINDOW, () => {
        windowManager.createAgentWindow()
    })

    // ── 配置 CRUD ────────────────────────────────────────────────────
    ipcMain.handle(IpcChannels.AGENT_READ_CONFIG, () => {
        return agentService?.readConfig() ?? {}
    })

    ipcMain.handle(IpcChannels.AGENT_WRITE_CONFIG, (_e, partial: AgentConfig) => {
        agentService?.writeConfig(partial ?? {})
        return true
    })

    ipcMain.handle(IpcChannels.AGENT_CLEAR_CONFIG, () => {
        agentService?.clearConfig(['apiKey'])
        return true
    })

    // ── 對話歷史 ─────────────────────────────────────────────────────
    ipcMain.handle(
        IpcChannels.AGENT_LIST_MESSAGES,
        (_e, params: { conversationId: string; limit?: number }) => {
            if (!params?.conversationId) return []
            return agentService?.listMessages(params.conversationId, params.limit) ?? []
        },
    )

    ipcMain.handle(IpcChannels.AGENT_SAVE_MESSAGE, (_e, msg: AgentMessage) => {
        agentService?.saveMessage(msg)
        return true
    })

    ipcMain.handle(
        IpcChannels.AGENT_CLEAR_MESSAGES,
        (_e, params?: { conversationId?: string }) => {
            agentService?.clearMessages(params?.conversationId)
            return true
        },
    )

    ipcMain.handle(IpcChannels.AGENT_LIST_CONVERSATIONS, () => {
        return agentService?.listConversations() ?? []
    })

    // ── 工具執行(委派給 AgentToolService) ──────────────────────────
    ipcMain.handle(IpcChannels.AGENT_EXEC_TOOL, async (_e, raw: unknown) => {
        // 1. zod schema 驗證:擋掉明顯異常 payload
        const parsed = ExecToolPayloadSchema.safeParse(raw)
        if (!parsed.success) {
            logger.warn(
                `agent:exec-tool payload schema 不通過 → ${parsed.error.message}`,
                'Agent',
            )
            return {ok: false, content: '', error: `payload invalid: ${parsed.error.message}`}
        }
        const {name, args} = parsed.data

        // 2. 委派給 service 執行
        try {
            return await agentToolService.execute(name, args)
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            logger.warn(`agent 工具執行失敗:${name} → ${msg}`, 'Agent')
            return {ok: false, content: '', error: msg}
        }
    })
}
