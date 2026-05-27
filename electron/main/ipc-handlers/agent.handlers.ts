/**
 * Agent 功能 IPC handler。
 *
 * 兩類 channel:
 *  1. AGENT_OPEN_WINDOW:任意窗口開 Agent 獨立窗口
 *  2. agent:exec-tool / agent:read-config / ...:Agent 窗口自身的 IPC 出口
 *
 * 設計重點:
 *  - 工具執行集中在 executeTool() 內部 dispatch,新增工具只動本檔
 *  - 所有檔案操作做最小校驗(路徑必須是字串、避免明顯空值),不做沙箱化
 *    (內網應用,信任使用者,跟既有 work-collector 同樣的信任模型)
 *  - run_command 用 execFile 而非 shell:string,降低 shell injection 機會
 */

import {clipboard, desktopCapturer, ipcMain, screen, shell} from 'electron'
import {execFile} from 'node:child_process'
import {promises as fs} from 'node:fs'
import path from 'node:path'
import {IpcChannels} from '../../shared/ipc-channels'
import {logger} from '../utils/logger'
import type {WindowManager} from '../window-manager'
import type {AgentConfig, AgentMessage, AgentService} from '../db/features/agent/service'

/** 工具執行結果:渲染端會 JSON.stringify 後注入給 LLM */
interface ToolExecResult {
    ok: boolean
    content: string
    error?: string
}

/** 工具回傳的 content 截斷上限(對齊設計文檔 §6.2) */
const MAX_CONTENT = 4000
const MAX_LIST = 2000
const MAX_CMD = 3000

export function registerAgentHandlers(
    windowManager: WindowManager,
    agentService: AgentService | null
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
        }
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
        }
    )

    ipcMain.handle(IpcChannels.AGENT_LIST_CONVERSATIONS, () => {
        return agentService?.listConversations() ?? []
    })

    // ── 工具執行(dispatch) ──────────────────────────────────────────
    ipcMain.handle(
        IpcChannels.AGENT_EXEC_TOOL,
        async (_e, payload: { name: string; args: Record<string, unknown> }): Promise<ToolExecResult> => {
            const {name, args} = payload || {name: '', args: {}}
            try {
                return await executeTool(name, args ?? {})
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err)
                logger.warn(`agent 工具執行失敗:${name} → ${msg}`, 'Agent')
                return {ok: false, content: '', error: msg}
            }
        }
    )
}

async function executeTool(name: string, args: Record<string, unknown>): Promise<ToolExecResult> {
    switch (name) {
        case 'open_app':
            return await openApp(args)
        case 'read_file':
            return await readFile(args)
        case 'write_file':
            return await writeFile(args)
        case 'list_files':
            return await listFiles(args)
        case 'run_command':
            return await runCommand(args)
        case 'screenshot':
            return await screenshot()
        case 'clipboard_read':
            return clipboardRead()
        case 'clipboard_write':
            return clipboardWrite(args)
        default:
            return {ok: false, content: '', error: `未知工具:${name}`}
    }
}

// ── 工具實作 ──────────────────────────────────────────────────────

async function openApp(args: Record<string, unknown>): Promise<ToolExecResult> {
    const appPath = String(args.appPath ?? '').trim()
    if (!appPath) return {ok: false, content: '', error: 'appPath 不能為空'}
    // shell.openPath 支援可執行檔路徑、文件夾、註冊的 protocol;對 'notepad' 這類
    // 系統命令不行 — 用 execFile 兜底
    try {
        const result = await shell.openPath(appPath)
        if (!result) return {ok: true, content: `已開啟:${appPath}`}
        // openPath 失敗則 fallback:用 child_process 啟動(start command)
        return await new Promise((resolve) => {
            execFile(appPath, [], {windowsHide: false}, (err) => {
                if (err) resolve({ok: false, content: '', error: `開啟失敗:${err.message}`})
                else resolve({ok: true, content: `已開啟:${appPath}`})
            })
        })
    } catch (err) {
        return {ok: false, content: '', error: String(err)}
    }
}

async function readFile(args: Record<string, unknown>): Promise<ToolExecResult> {
    const filePath = String(args.path ?? '').trim()
    if (!filePath) return {ok: false, content: '', error: 'path 不能為空'}
    const buf = await fs.readFile(filePath, 'utf8')
    return {ok: true, content: truncate(buf, MAX_CONTENT)}
}

async function writeFile(args: Record<string, unknown>): Promise<ToolExecResult> {
    const filePath = String(args.path ?? '').trim()
    const content = String(args.content ?? '')
    if (!filePath) return {ok: false, content: '', error: 'path 不能為空'}
    await fs.mkdir(path.dirname(filePath), {recursive: true})
    await fs.writeFile(filePath, content, 'utf8')
    return {ok: true, content: `已寫入 ${content.length} 字元到 ${filePath}`}
}

async function listFiles(args: Record<string, unknown>): Promise<ToolExecResult> {
    const dirPath = String(args.path ?? '').trim()
    if (!dirPath) return {ok: false, content: '', error: 'path 不能為空'}
    const entries = await fs.readdir(dirPath, {withFileTypes: true})
    const list = entries
        .map((e) => `${e.isDirectory() ? '[DIR] ' : '      '}${e.name}`)
        .join('\n')
    return {ok: true, content: truncate(list, MAX_LIST)}
}

async function runCommand(args: Record<string, unknown>): Promise<ToolExecResult> {
    const command = String(args.command ?? '').trim()
    const rawArgs = Array.isArray(args.args) ? (args.args as unknown[]).map(String) : []
    if (!command) return {ok: false, content: '', error: 'command 不能為空'}
    return await new Promise((resolve) => {
        execFile(
            command,
            rawArgs,
            {timeout: 15_000, windowsHide: true, maxBuffer: 1024 * 1024},
            (err, stdout, stderr) => {
                const out = (stdout || '') + (stderr ? `\n[stderr] ${stderr}` : '')
                if (err && !stdout && !stderr) {
                    resolve({ok: false, content: '', error: err.message})
                } else {
                    resolve({ok: true, content: truncate(out || '(無輸出)', MAX_CMD)})
                }
            }
        )
    })
}

async function screenshot(): Promise<ToolExecResult> {
    // 取主顯示器尺寸,thumbnail 寬高用 display 實際解析度
    const display = screen.getPrimaryDisplay()
    const {width, height} = display.size
    const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: {width, height},
    })
    const primary = sources[0]
    if (!primary) return {ok: false, content: '', error: '取不到螢幕來源'}
    // 回傳 base64 dataURL,渲染端可直接展示在訊息卡片
    const dataUrl = primary.thumbnail.toDataURL()
    return {ok: true, content: dataUrl}
}

function clipboardRead(): ToolExecResult {
    const text = clipboard.readText()
    return {ok: true, content: truncate(text, MAX_CONTENT)}
}

function clipboardWrite(args: Record<string, unknown>): ToolExecResult {
    const text = String(args.text ?? '')
    clipboard.writeText(text)
    return {ok: true, content: `已寫入剪貼簿 ${text.length} 字元`}
}

function truncate(s: string, max: number): string {
    if (s.length <= max) return s
    return s.slice(0, max) + `\n...(截斷,原長度 ${s.length})`
}
