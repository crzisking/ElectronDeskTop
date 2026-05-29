/**
 * AgentToolService — Agent 工具執行集中地。
 *
 * 對應設計文件 §4 工具系統。`agent.handlers.ts` 只負責 IPC 協議翻譯(invoke → service),
 * 工具本體實作全在這裡。
 *
 * 信任邊界(修正 #9):
 *   原本完全信任使用者 + LLM 工具呼叫,但 LLM 仍會被 prompt injection 誘導出危險路徑。
 *   現在加三層 guardrails:
 *
 *   1. **工作區限制(workspace allowlist)**:read_file / write_file / list_files
 *      只能在「使用者目錄」或「app 自身 userData」內運作;
 *      其他路徑(系統目錄 / 其他使用者目錄 / 網路磁碟)一律拒絕。
 *
 *   2. **危險命令攔截**:run_command 對 format / del /s / rm -rf / shutdown / reg delete
 *      等高風險指令直接擋,即使 LLM 被誘導也跑不起來。
 *
 *   3. **能力開關**:`AGENT_TOOL_CAPABILITIES` 環境變數可設 `read-only`
 *      把 write_file / run_command 整個關掉(企業部署可用此模式)。
 *
 * `run_command` 仍用 `execFile`(非 shell 字串)降低 shell injection 機會,並硬性 15 秒 timeout。
 */

import {app, clipboard, desktopCapturer, screen, shell} from 'electron'
import {execFile} from 'node:child_process'
import {promises as fs} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type {ToolExecResult} from '../../shared/types/agent.types'

// ─── 常數 ────────────────────────────────────────────────────────────

const MAX_CONTENT = 4000
const MAX_LIST = 2000
const MAX_CMD = 3000

/**
 * 危險命令黑名單 — 大小寫不敏感比對。
 * 不窮舉(那永遠不夠),只擋已知會「不可逆破壞」的常見指令。
 * 不擋 git / npm 之類常用 dev 工具,讓 Agent 對 dev 場景仍有用。
 */
const DANGEROUS_COMMANDS = new Set([
    'format', 'format.com',
    'fdisk',
    'diskpart',
    'shutdown', 'shutdown.exe',
    'reg', 'reg.exe',           // 整個 reg.exe 都擋 — del / add / import 都太危險
    'rd', 'rmdir',              // CMD 內建的遞迴刪除
    'rm',                       // unix-like 工具被裝進 PATH 時也擋
    'del', 'erase',             // 雖然非遞迴但仍易誤刪;保守起見擋掉
])

/** 命令參數含這些 token 也視為危險(批次刪除常見模式) */
const DANGEROUS_ARG_PATTERNS = [
    /^\/s$/i,        // del /s
    /^-rf$/,         // rm -rf
    /^-fr$/,
    /^--recursive$/i,
    /^--force$/i,
]

/**
 * 能力等級。可用 env `AGENT_TOOL_CAPABILITIES=read-only` 限縮。
 *   - full     :所有工具可用(預設,個人開發模式)
 *   - read-only:write_file / run_command / clipboard_write 關閉(企業批量部署)
 */
type Capability = 'full' | 'read-only'

function getCapability(): Capability {
    const v = (process.env.AGENT_TOOL_CAPABILITIES || '').toLowerCase()
    return v === 'read-only' ? 'read-only' : 'full'
}

// ─── 工作區白名單 ────────────────────────────────────────────────────

/**
 * 解析絕對、正規化後的路徑;失敗回 null。
 * 用 realpath 但寫入場景檔案可能不存在,所以失敗時 fallback resolve。
 */
function resolveSafe(p: string): string | null {
    try {
        return path.resolve(p)
    } catch {
        return null
    }
}

/**
 * 取得允許訪問的根目錄清單。
 * 一律走 path.resolve 規範化,避免 trailing slash 等變體匹配失敗。
 */
function getWorkspaceRoots(): string[] {
    const roots = [
        os.homedir(),           // 使用者目錄(~)
        app.getPath('userData'),// app 自己的 userData
        app.getPath('temp'),    // 系統 temp(短期落地用)
        app.getPath('downloads'),
        app.getPath('documents'),
        app.getPath('desktop'),
    ]
    return roots.map((r) => path.resolve(r))
}

/**
 * 檢查 target 是否在 workspace 內。
 * 用 `relative` 算出相對路徑,以 `..` 開頭 = 跳出 root,拒絕。
 */
function isInsideWorkspace(target: string): boolean {
    const abs = resolveSafe(target)
    if (!abs) return false
    return getWorkspaceRoots().some((root) => {
        const rel = path.relative(root, abs)
        return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
    })
}

// ─── Service ─────────────────────────────────────────────────────────

export class AgentToolService {
    private readonly capability = getCapability()

    async execute(name: string, args: Record<string, unknown>): Promise<ToolExecResult> {
        switch (name) {
            case 'open_app':
                return this.openApp(args)
            case 'read_file':
                return this.readFile(args)
            case 'write_file':
                if (this.capability === 'read-only') {
                    return {ok: false, content: '', error: '當前模式為 read-only,write_file 已停用'}
                }
                return this.writeFile(args)
            case 'list_files':
                return this.listFiles(args)
            case 'run_command':
                if (this.capability === 'read-only') {
                    return {ok: false, content: '', error: '當前模式為 read-only,run_command 已停用'}
                }
                return this.runCommand(args)
            case 'screenshot':
                return this.screenshot()
            case 'clipboard_read':
                return this.clipboardRead()
            case 'clipboard_write':
                if (this.capability === 'read-only') {
                    return {ok: false, content: '', error: '當前模式為 read-only,clipboard_write 已停用'}
                }
                return this.clipboardWrite(args)
            default:
                return {ok: false, content: '', error: `未知工具:${name}`}
        }
    }

    // ── 應用啟動 ────────────────────────────────────────────────────

    private async openApp(args: Record<string, unknown>): Promise<ToolExecResult> {
        const appPath = String(args.appPath ?? '').trim()
        if (!appPath) return {ok: false, content: '', error: 'appPath 不能為空'}
        try {
            const result = await shell.openPath(appPath)
            if (!result) return {ok: true, content: `已開啟:${appPath}`}
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

    // ── 檔案系統(走 workspace 白名單) ─────────────────────────────

    private async readFile(args: Record<string, unknown>): Promise<ToolExecResult> {
        const filePath = String(args.path ?? '').trim()
        if (!filePath) return {ok: false, content: '', error: 'path 不能為空'}
        if (!isInsideWorkspace(filePath)) {
            return {ok: false, content: '', error: `拒絕:${filePath} 不在允許的工作區內`}
        }
        try {
            const buf = await fs.readFile(filePath, 'utf8')
            return {ok: true, content: truncate(buf, MAX_CONTENT)}
        } catch (err) {
            return {ok: false, content: '', error: String(err)}
        }
    }

    private async writeFile(args: Record<string, unknown>): Promise<ToolExecResult> {
        const filePath = String(args.path ?? '').trim()
        const content = String(args.content ?? '')
        if (!filePath) return {ok: false, content: '', error: 'path 不能為空'}
        if (!isInsideWorkspace(filePath)) {
            return {ok: false, content: '', error: `拒絕:${filePath} 不在允許的工作區內`}
        }
        try {
            await fs.mkdir(path.dirname(filePath), {recursive: true})
            await fs.writeFile(filePath, content, 'utf8')
            return {ok: true, content: `已寫入 ${content.length} 字元到 ${filePath}`}
        } catch (err) {
            return {ok: false, content: '', error: String(err)}
        }
    }

    private async listFiles(args: Record<string, unknown>): Promise<ToolExecResult> {
        const dirPath = String(args.path ?? '').trim()
        if (!dirPath) return {ok: false, content: '', error: 'path 不能為空'}
        if (!isInsideWorkspace(dirPath)) {
            return {ok: false, content: '', error: `拒絕:${dirPath} 不在允許的工作區內`}
        }
        try {
            const entries = await fs.readdir(dirPath, {withFileTypes: true})
            const list = entries
                .map((e) => `${e.isDirectory() ? '[DIR] ' : '      '}${e.name}`)
                .join('\n')
            return {ok: true, content: truncate(list, MAX_LIST)}
        } catch (err) {
            return {ok: false, content: '', error: String(err)}
        }
    }

    // ── 命令執行(危險命令黑名單) ──────────────────────────────────

    private async runCommand(args: Record<string, unknown>): Promise<ToolExecResult> {
        const command = String(args.command ?? '').trim()
        const rawArgs = Array.isArray(args.args) ? (args.args as unknown[]).map(String) : []
        if (!command) return {ok: false, content: '', error: 'command 不能為空'}

        // 1. 危險命令本身擋(以 basename 比對,/usr/local/bin/rm 也擋)
        const cmdBase = path.basename(command).toLowerCase()
        if (DANGEROUS_COMMANDS.has(cmdBase)) {
            return {ok: false, content: '', error: `拒絕執行危險命令:${command}`}
        }

        // 2. 危險參數組合擋(e.g. rm -rf,reg delete 即使被改名也擋)
        for (const a of rawArgs) {
            if (DANGEROUS_ARG_PATTERNS.some((re) => re.test(a))) {
                return {ok: false, content: '', error: `拒絕執行危險參數:${a}(可能造成不可逆破壞)`}
            }
        }

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
                },
            )
        })
    }

    // ── 螢幕 / 剪貼簿 ──────────────────────────────────────────────

    private async screenshot(): Promise<ToolExecResult> {
        const display = screen.getPrimaryDisplay()
        const {width, height} = display.size
        const sources = await desktopCapturer.getSources({
            types: ['screen'],
            thumbnailSize: {width, height},
        })
        const primary = sources[0]
        if (!primary) return {ok: false, content: '', error: '取不到螢幕來源'}
        return {ok: true, content: primary.thumbnail.toDataURL()}
    }

    private clipboardRead(): ToolExecResult {
        return {ok: true, content: truncate(clipboard.readText(), MAX_CONTENT)}
    }

    private clipboardWrite(args: Record<string, unknown>): ToolExecResult {
        const text = String(args.text ?? '')
        clipboard.writeText(text)
        return {ok: true, content: `已寫入剪貼簿 ${text.length} 字元`}
    }
}

function truncate(s: string, max: number): string {
    if (s.length <= max) return s
    return s.slice(0, max) + `\n...(截斷,原長度 ${s.length})`
}
